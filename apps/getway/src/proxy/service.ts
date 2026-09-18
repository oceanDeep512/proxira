import type {
  ProxyGroup,
  ProxyPayloadBody,
  ProxyRule,
  ProxyTrafficRecord,
} from "@proxira/core";
import type { RuntimeDeps } from "../app/types.js";
import { RuntimeStore } from "../app/runtime-store.js";
import { AppError } from "../shared/errors.js";
import {
  buildDownstreamHeaders,
  buildUpstreamUrl,
  collectBody,
  collectHeaders,
  collectQuery,
  isStreamingContentType,
  stripHeaders,
  REQUEST_STRIP_HEADERS,
} from "../shared/http.js";

const isTimeoutError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as { name?: string }).name === "TimeoutError";
};

// While a long stream is still running, surface the already-sampled bytes to
// the dashboard at this interval instead of waiting for the stream to finish.
const STREAM_SAMPLE_EMIT_INTERVAL_MS = 1_000;

const mergeChunks = (chunks: Uint8Array[], total: number): Uint8Array => {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
};

// Read a tee'd capture branch without blocking the client branch.
// `maxCaptureBytes` / `timeBudgetMs` 为 0 时表示不设上限——流式响应默认就是
// 不限制，否则一段长的 SSE / LLM 流会被我们截掉，排查时无从下手。
// `onSample` receives the accumulated bytes periodically while sampling, so
// the dashboard can preview a stream that is still in flight.
const sampleStreamBody = async (
  stream: ReadableStream<Uint8Array>,
  maxCaptureBytes: number,
  timeBudgetMs: number,
  onSample?: (bytes: Uint8Array, truncated: boolean) => void,
): Promise<{ bytes: Uint8Array; truncated: boolean } | null> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const deadline =
    timeBudgetMs > 0 ? Date.now() + timeBudgetMs : Number.POSITIVE_INFINITY;
  let lastEmitAt = Date.now();
  let hasEmitted = false;

  const emitSample = (): void => {
    if (!onSample || chunks.length === 0) {
      return;
    }
    onSample(mergeChunks(chunks, total), false);
    lastEmitAt = Date.now();
    hasEmitted = true;
  };

  try {
    while (true) {
      if (Date.now() >= deadline) {
        truncated = true;
        await reader.cancel("sample time budget reached").catch(() => undefined);
        break;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (maxCaptureBytes > 0 && total >= maxCaptureBytes) {
          truncated = true;
          await reader.cancel("sample byte limit reached").catch(() => undefined);
          break;
        }
        // Publish the first chunk immediately so the dashboard shows content
        // as soon as the stream starts; afterwards throttle to once a second.
        if (!hasEmitted || Date.now() - lastEmitAt >= STREAM_SAMPLE_EMIT_INTERVAL_MS) {
          emitSample();
        }
      }
    }
  } catch {
    // Client disconnected or upstream aborted mid-sample: keep what we have.
    truncated = true;
  }

  if (chunks.length === 0) {
    return null;
  }
  return { bytes: mergeChunks(chunks, total), truncated };
};

export class ProxyService {
  constructor(
    private readonly deps: RuntimeDeps,
    private readonly runtime: RuntimeStore,
  ) {}

  matchIncomingUrl(rawUrl: string): URL | null {
    const incomingUrl = new URL(rawUrl);
    if (!this.deps.config.proxyPrefixEnabled) {
      return this.isInternalPath(incomingUrl.pathname) ? null : incomingUrl;
    }

    const { proxyPrefix } = this.deps.config;
    const matchesPrefix =
      incomingUrl.pathname === proxyPrefix ||
      incomingUrl.pathname.startsWith(`${proxyPrefix}/`);
    if (!matchesPrefix) {
      return null;
    }

    const nextPath = incomingUrl.pathname.slice(proxyPrefix.length);
    incomingUrl.pathname = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
    if (incomingUrl.pathname.length === 0) {
      incomingUrl.pathname = "/";
    }

    // Never let a request reach an upstream under the reserved internal prefix,
    // even when the business prefix is disabled and everything else forwards.
    if (this.isInternalPath(incomingUrl.pathname)) {
      return null;
    }

    return incomingUrl;
  }

  private isInternalPath(pathname: string): boolean {
    const { internalRoutePrefix } = this.deps.config;
    return (
      pathname === internalRoutePrefix ||
      pathname.startsWith(`${internalRoutePrefix}/`)
    );
  }

  async forward(request: Request): Promise<Response | null> {
    const startedAtMs = this.deps.now();
    const incomingUrl = this.matchIncomingUrl(request.url);
    if (!incomingUrl) {
      return null;
    }

    const activeGroup = this.runtime.getProxyGroup();
    const requestContentLengthRaw = request.headers.get("content-length")?.trim();
    const requestContentLength = requestContentLengthRaw
      ? Number(requestContentLengthRaw)
      : Number.NaN;
    if (
      Number.isFinite(requestContentLength) &&
      requestContentLength > this.deps.config.requestContentLengthLimit
    ) {
      throw new AppError(
        413,
        `Request body is too large. Limit is ${this.deps.config.requestContentLengthLimit} bytes.`,
      );
    }

    const upstreamUrl = buildUpstreamUrl(activeGroup.targetBaseUrl, incomingUrl);
    const method = request.method.toUpperCase();
    const requestBuffer = await request
      .clone()
      .arrayBuffer()
      .catch(() => new ArrayBuffer(0));
    const requestBytes = new Uint8Array(requestBuffer);
    const requestBody = collectBody(
      requestBytes,
      request.headers.get("content-type"),
      this.deps.config.maxBodyCaptureBytes,
    );
    const requestHeaders = collectHeaders(request.headers);
    const query = collectQuery(incomingUrl);

    const upstreamRequestHeaders = stripHeaders(request.headers, REQUEST_STRIP_HEADERS);
    upstreamRequestHeaders.delete("accept-encoding");

    const upstreamRequest: RequestInit = {
      method,
      headers: upstreamRequestHeaders,
      redirect: "manual",
      // A group can override the global budget (e.g. slow non-streaming LLM
      // calls); null means "fall back to the configured default".
      signal: AbortSignal.timeout(
        activeGroup.upstreamTimeoutMs ?? this.deps.config.upstreamTimeoutMs,
      ),
    };
    if (method !== "GET" && method !== "HEAD" && requestBytes.length > 0) {
      upstreamRequest.body = requestBytes;
    }

    // Intervention rules: reproduce failures and stub responses on demand
    // instead of waiting for them to happen by accident.
    const rule = this.runtime.matchRule(activeGroup.id, method, incomingUrl.pathname);
    if (rule) {
      return this.applyRule({
        rule,
        startedAtMs,
        activeGroup,
        method,
        path: incomingUrl.pathname,
        query,
        requestHeaders,
        requestBody,
        upstreamUrl: upstreamUrl.toString(),
        upstreamRequest,
      });
    }

    try {
      const upstreamResponse = await this.deps.fetch(upstreamUrl, upstreamRequest);
      const contentType = upstreamResponse.headers.get("content-type");

      // Endless streams (SSE, multipart replace) never finish, so buffering
      // them would hang the request. Tee the stream instead: the client gets
      // the untouched branch immediately, while a background reader samples
      // the capture branch (up to maxBodyCaptureBytes) for the history record.
      if (upstreamResponse.body && isStreamingContentType(contentType)) {
        const [clientStream, captureStream] = upstreamResponse.body.tee();
        const record = this.createRecord({
          groupId: activeGroup.id,
          method,
          path: incomingUrl.pathname,
          query,
          requestHeaders,
          requestBody,
          upstreamUrl: upstreamUrl.toString(),
          responseStatus: upstreamResponse.status,
          responseHeaders: collectHeaders(upstreamResponse.headers),
          responseBody: null,
          durationMs: this.deps.now() - startedAtMs,
          error: null,
          appliedRuleId: null,
          source: "proxy",
        });
        this.runtime.addProxyRecord(activeGroup.id, record);

        void this.sampleStreamingResponse(
          captureStream,
          contentType,
          record.id,
          activeGroup.id,
        );

        return new Response(clientStream, {
          status: upstreamResponse.status,
          headers: buildDownstreamHeaders(upstreamResponse.headers, method),
        });
      }

      const responseBuffer = await upstreamResponse
        .arrayBuffer()
        .catch(() => new ArrayBuffer(0));
      const responseBytes = new Uint8Array(responseBuffer);
      const responseBody = collectBody(
        responseBytes,
        contentType,
        this.deps.config.maxBodyCaptureBytes,
      );
      const responseHeaders = collectHeaders(upstreamResponse.headers);

      this.runtime.addProxyRecord(
        activeGroup.id,
        this.createRecord({
          groupId: activeGroup.id,
          method,
          path: incomingUrl.pathname,
          query,
          requestHeaders,
          requestBody,
          upstreamUrl: upstreamUrl.toString(),
          responseStatus: upstreamResponse.status,
          responseHeaders,
          responseBody,
          durationMs: this.deps.now() - startedAtMs,
          error: null,
          appliedRuleId: null,
          source: "proxy",
        }),
      );

      return new Response(responseBytes, {
        status: upstreamResponse.status,
        headers: buildDownstreamHeaders(
          upstreamResponse.headers,
          method,
          responseBytes.byteLength,
        ),
      });
    } catch (error) {
      const effectiveTimeoutMs =
        activeGroup.upstreamTimeoutMs ?? this.deps.config.upstreamTimeoutMs;
      const timedOut = isTimeoutError(error);
      const message = timedOut
        ? `Upstream did not respond within ${effectiveTimeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "Unknown proxy error";
      this.runtime.addProxyRecord(
        activeGroup.id,
        this.createRecord({
          groupId: activeGroup.id,
          method,
          path: incomingUrl.pathname,
          query,
          requestHeaders,
          requestBody,
          upstreamUrl: upstreamUrl.toString(),
          responseStatus: null,
          responseHeaders: {},
          responseBody: null,
          durationMs: this.deps.now() - startedAtMs,
          error: message,
          appliedRuleId: null,
          source: "proxy",
        }),
      );

      return Response.json(
        {
          message: timedOut
            ? "Proxy upstream timed out."
            : "Proxy forwarding failed.",
          error: message,
        },
        { status: timedOut ? 504 : 502 },
      );
    }
  }

  // Background sampling for streaming responses: fills the record's body once
  // the stream ends or the capture budget is exhausted. Never blocks the
  // client — failures simply leave the record with a null body.
  // Emit a stubbed body either at once or as a paced SSE stream, so mock rules
  // can imitate a real token stream instead of a single blob.
  private buildRuleStream(rule: ProxyRule): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const chunks = rule.body
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => encoder.encode(`${part}\n\n`));
    const interval = rule.chunkIntervalMs;

    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        const chunk = chunks[index];
        index += 1;
        controller.enqueue(chunk);
        if (interval > 0) {
          return new Promise<void>((resolve) => setTimeout(resolve, interval));
        }
      },
    });
  }

  // Cut a stream short after N chunks, or clip it at a byte budget: the two
  // failure modes a streaming client is most likely to mishandle.
  private shapeStream(
    source: ReadableStream<Uint8Array>,
    rule: ProxyRule,
  ): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    let delivered = 0;
    let bytes = 0;

    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          if (value) {
            if (rule.action === "truncate" && bytes + value.byteLength > rule.keepBytes) {
              const allowed = Math.max(0, rule.keepBytes - bytes);
              if (allowed > 0) {
                controller.enqueue(value.slice(0, allowed));
              }
              // Abrupt end, no closing event: that is the point of the rule.
              // tee'd branch cancel resolves only once every branch is
              // cancelled, so never await it here.
              void reader.cancel("rule truncated response").catch(() => undefined);
              controller.close();
              return;
            }
            controller.enqueue(value);
            bytes += value.byteLength;
            delivered += 1;
            if (rule.action === "break_stream" && delivered >= rule.afterChunks) {
              void reader.cancel("rule broke stream").catch(() => undefined);
              controller.close();
            }
          }
        } catch {
          controller.close();
        }
      },
      cancel: () => {
        void reader.cancel("client cancelled").catch(() => undefined);
      },
    });
  }

  // Re-issue a request against the upstream without going through the rule
  // engine (a replay must show what the real upstream does).
  async replay(payload: {
    recordId?: string | undefined;
    method?: string | undefined;
    url?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  }): Promise<{
    ok: boolean;
    status: number | null;
    durationMs: number;
    headers: Record<string, string>;
    body: string | null;
    recordId: string | null;
    error: string | null;
  }> {
    const activeGroup = this.runtime.getProxyGroup();
    const startedAtMs = this.deps.now();

    let method = payload.method?.toUpperCase() ?? "GET";
    let url = payload.url ?? "";
    let headers = payload.headers ?? {};
    let body = payload.body ?? "";

    if (payload.recordId) {
      const record = this.runtime.getRecord(activeGroup.id, payload.recordId).item;
      if (!record) {
        throw new AppError(404, "record not found.");
      }
      method = record.method;
      url = record.upstreamUrl;
      headers = Object.fromEntries(
        Object.entries(record.requestHeaders).map(([name, value]) => [
          name,
          Array.isArray(value) ? value[0] ?? "" : value,
        ]),
      );
      body = record.requestBody.text ?? "";
    }

    if (!url) {
      throw new AppError(400, "url is required.");
    }

    const upstreamRequestHeaders = new Headers();
    for (const [name, value] of Object.entries(headers)) {
      if (REQUEST_STRIP_HEADERS.some((key) => key === name.toLowerCase())) {
        continue;
      }
      upstreamRequestHeaders.set(name, value);
    }
    upstreamRequestHeaders.delete("accept-encoding");
    upstreamRequestHeaders.delete("content-length");

    const encoder = new TextEncoder();
    const requestBytes = encoder.encode(body);
    const hasBody = method !== "GET" && method !== "HEAD" && body.length > 0;

    try {
      const replayRequest: RequestInit = {
        method,
        headers: upstreamRequestHeaders,
        redirect: "manual",
        signal: AbortSignal.timeout(
          activeGroup.upstreamTimeoutMs ?? this.deps.config.upstreamTimeoutMs,
        ),
      };
      if (hasBody) {
        replayRequest.body = requestBytes;
      }
      const upstreamResponse = await this.deps.fetch(url, replayRequest);
      const responseText = await upstreamResponse.text();
      const responseHeaders: Record<string, string> = {};
      upstreamResponse.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const parsedUrl = new URL(url);
      const record = this.createRecord({
        groupId: activeGroup.id,
        method,
        path: parsedUrl.pathname,
        query: collectQuery(parsedUrl),
        requestHeaders: headers,
        requestBody: collectBody(
          requestBytes,
          upstreamRequestHeaders.get("content-type"),
          this.deps.config.maxBodyCaptureBytes,
        ),
        upstreamUrl: url,
        responseStatus: upstreamResponse.status,
        responseHeaders,
        responseBody: collectBody(
          encoder.encode(responseText),
          upstreamResponse.headers.get("content-type"),
          this.deps.config.maxBodyCaptureBytes,
        ),
        durationMs: this.deps.now() - startedAtMs,
        error: null,
        appliedRuleId: null,
        source: "replay",
      });
      this.runtime.addProxyRecord(activeGroup.id, record);

      return {
        ok: true,
        status: upstreamResponse.status,
        durationMs: this.deps.now() - startedAtMs,
        headers: responseHeaders,
        body: responseText,
        recordId: record.id,
        error: null,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Replay failed.";
      return {
        ok: false,
        status: null,
        durationMs: this.deps.now() - startedAtMs,
        headers: {},
        body: null,
        recordId: null,
        error: message,
      };
    }
  }

  private async applyRule(ctx: {
    rule: ProxyRule;
    startedAtMs: number;
    activeGroup: ProxyGroup;
    method: string;
    path: string;
    query: ReturnType<typeof collectQuery>;
    requestHeaders: ReturnType<typeof collectHeaders>;
    requestBody: ProxyPayloadBody;
    upstreamUrl: string;
    upstreamRequest: RequestInit;
  }): Promise<Response> {
    const { rule } = ctx;

    if (rule.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
    }

    const base = {
      groupId: ctx.activeGroup.id,
      method: ctx.method,
      path: ctx.path,
      query: ctx.query,
      requestHeaders: ctx.requestHeaders,
      requestBody: ctx.requestBody,
      upstreamUrl: ctx.upstreamUrl,
      durationMs: this.deps.now() - ctx.startedAtMs,
      appliedRuleId: rule.id,
      source: "proxy" as const,
    };

    if (rule.action === "mock") {
      const headers = new Headers();
      for (const [name, value] of Object.entries(rule.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            headers.append(name, item);
          }
        } else if (value !== undefined) {
          headers.set(name, value);
        }
      }
      if (rule.stream) {
        if (!headers.has("content-type")) {
          headers.set("content-type", "text/event-stream");
        }
      } else if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }

      const encoder = new TextEncoder();
      const bytes = encoder.encode(rule.body);
      const downstreamHeaders = buildDownstreamHeaders(headers, ctx.method);

      if (rule.stream) {
        const [clientStream, captureStream] = this.buildRuleStream(rule).tee();
        const record = this.createRecord({
          ...base,
          responseStatus: rule.status,
          responseHeaders: collectHeaders(headers),
          responseBody: null,
          error: null,
        });
        this.runtime.addProxyRecord(ctx.activeGroup.id, record);
        void this.sampleStreamingResponse(
          captureStream,
          headers.get("content-type"),
          record.id,
          ctx.activeGroup.id,
        );
        return new Response(clientStream, {
          status: rule.status,
          headers: downstreamHeaders,
        });
      }

      const record = this.createRecord({
        ...base,
        responseStatus: rule.status,
        responseHeaders: collectHeaders(headers),
        responseBody: collectBody(
          bytes,
          headers.get("content-type"),
          this.deps.config.maxBodyCaptureBytes,
        ),
        error: null,
      });
      this.runtime.addProxyRecord(ctx.activeGroup.id, record);
      return new Response(bytes, { status: rule.status, headers: downstreamHeaders });
    }

    if (rule.action === "error") {
      const payload = Response.json(
        { message: rule.message, rule: rule.name },
        { status: rule.status },
      );
      const record = this.createRecord({
        ...base,
        responseStatus: rule.status,
        responseHeaders: collectHeaders(payload.headers),
        responseBody: collectBody(
          new TextEncoder().encode(JSON.stringify({ message: rule.message })),
          "application/json",
          this.deps.config.maxBodyCaptureBytes,
        ),
        error: rule.message,
      });
      this.runtime.addProxyRecord(ctx.activeGroup.id, record);
      return payload;
    }

    // delay / break_stream / truncate still hit the upstream, then the response
    // is shaped on the way back.
    try {
      const upstreamResponse = await this.deps.fetch(
        new URL(ctx.upstreamUrl),
        ctx.upstreamRequest,
      );
      const contentType = upstreamResponse.headers.get("content-type");

      if (upstreamResponse.body && isStreamingContentType(contentType)) {
        const [clientStream, captureStream] = upstreamResponse.body.tee();
        const shaped = this.shapeStream(clientStream, rule);
        const [shapedClient, shapedCapture] = shaped.tee();
        const record = this.createRecord({
          ...base,
          responseStatus: upstreamResponse.status,
          responseHeaders: collectHeaders(upstreamResponse.headers),
          responseBody: null,
          error: null,
        });
        this.runtime.addProxyRecord(ctx.activeGroup.id, record);
        void this.sampleStreamingResponse(
          // Sample what the client actually received.
          shapedCapture,
          contentType,
          record.id,
          ctx.activeGroup.id,
        );
        return new Response(shapedClient, {
          status: upstreamResponse.status,
          headers: buildDownstreamHeaders(upstreamResponse.headers, ctx.method),
        });
      }

      const responseBuffer = await upstreamResponse
        .arrayBuffer()
        .catch(() => new ArrayBuffer(0));
      let responseBytes = new Uint8Array(responseBuffer);
      if (rule.action === "truncate" && responseBytes.byteLength > rule.keepBytes) {
        responseBytes = responseBytes.slice(0, rule.keepBytes);
      }
      const record = this.createRecord({
        ...base,
        responseStatus: upstreamResponse.status,
        responseHeaders: collectHeaders(upstreamResponse.headers),
        responseBody: collectBody(
          responseBytes,
          contentType,
          this.deps.config.maxBodyCaptureBytes,
        ),
        error: null,
      });
      this.runtime.addProxyRecord(ctx.activeGroup.id, record);
      return new Response(responseBytes, {
        status: upstreamResponse.status,
        headers: buildDownstreamHeaders(
          upstreamResponse.headers,
          ctx.method,
          responseBytes.byteLength,
        ),
      });
    } catch (error) {
      const timedOut = isTimeoutError(error);
      const message = timedOut
        ? `Upstream did not respond within ${ctx.activeGroup.upstreamTimeoutMs ?? this.deps.config.upstreamTimeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "Unknown proxy error";
      const record = this.createRecord({
        ...base,
        responseStatus: null,
        responseHeaders: {},
        responseBody: null,
        error: message,
      });
      this.runtime.addProxyRecord(ctx.activeGroup.id, record);
      return Response.json(
        {
          message: timedOut ? "Proxy upstream timed out." : "Proxy forwarding failed.",
          error: message,
        },
        { status: timedOut ? 504 : 502 },
      );
    }
  }

  private async sampleStreamingResponse(
    stream: ReadableStream<Uint8Array>,
    contentType: string | null,
    recordId: string,
    groupId: string,
  ): Promise<void> {
    // Partial previews: patch the record while the stream is still running so
    // users can watch an SSE response grow in the dashboard instead of staring
    // at "streaming body not captured" for minutes.
    // 上限走流式专用配置（默认 0 = 不限制）。不能沿用非流式的 2MB 上限，
    // 否则增量预览和最终结果都会在半路被悄悄截断。
    const captureLimit =
      this.deps.config.streamMaxCaptureBytes > 0
        ? this.deps.config.streamMaxCaptureBytes
        : Number.MAX_SAFE_INTEGER;
    const emitPartial = (bytes: Uint8Array): void => {
      const partial = collectBody(bytes, contentType, captureLimit);
      this.runtime.updateProxyRecordBody(groupId, recordId, partial);
    };

    try {
      const sampled = await sampleStreamBody(
        stream,
        this.deps.config.streamMaxCaptureBytes,
        this.deps.config.streamMaxCaptureMs,
        emitPartial,
      );
      if (!sampled) {
        return;
      }
      const collected = collectBody(sampled.bytes, contentType, captureLimit);
      const responseBody: ProxyPayloadBody = sampled.truncated
        ? { ...collected, truncated: true }
        : collected;
      this.runtime.updateProxyRecordBody(groupId, recordId, responseBody);
    } catch {
      // Sampling is best-effort by design.
    }
  }

  private createRecord(
    payload: Omit<ProxyTrafficRecord, "id" | "timestamp">,
  ): ProxyTrafficRecord {
    return {
      id: this.deps.randomUUID(),
      timestamp: new Date(this.deps.now()).toISOString(),
      ...payload,
    };
  }
}
