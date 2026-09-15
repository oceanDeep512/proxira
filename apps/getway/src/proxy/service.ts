import type { ProxyPayloadBody, ProxyTrafficRecord } from "@proxira/core";
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

// Upper bound on how long we keep sampling a streaming response for the
// history record. The client stream is never throttled by this — only the
// background capture gives up.
const STREAM_SAMPLE_TIME_BUDGET_MS = 60_000;

// Read a tee'd capture branch without blocking the client branch: stop at the
// byte limit or time budget, then cancel so the tee stops buffering for us.
const sampleStreamBody = async (
  stream: ReadableStream<Uint8Array>,
  maxCaptureBytes: number,
  timeBudgetMs: number,
): Promise<{ bytes: Uint8Array; truncated: boolean } | null> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const deadline = Date.now() + timeBudgetMs;

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
        if (total >= maxCaptureBytes) {
          truncated = true;
          await reader.cancel("sample byte limit reached").catch(() => undefined);
          break;
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
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: merged, truncated };
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
      signal: AbortSignal.timeout(this.deps.config.upstreamTimeoutMs),
    };
    if (method !== "GET" && method !== "HEAD" && requestBytes.length > 0) {
      upstreamRequest.body = requestBytes;
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
      const timedOut = isTimeoutError(error);
      const message = timedOut
        ? `Upstream did not respond within ${this.deps.config.upstreamTimeoutMs}ms.`
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
  private async sampleStreamingResponse(
    stream: ReadableStream<Uint8Array>,
    contentType: string | null,
    recordId: string,
    groupId: string,
  ): Promise<void> {
    try {
      const sampled = await sampleStreamBody(
        stream,
        this.deps.config.maxBodyCaptureBytes,
        STREAM_SAMPLE_TIME_BUDGET_MS,
      );
      if (!sampled) {
        return;
      }
      const collected = collectBody(
        sampled.bytes,
        contentType,
        this.deps.config.maxBodyCaptureBytes,
      );
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
