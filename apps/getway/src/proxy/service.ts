import type { ProxyTrafficRecord } from "@proxira/core";
import type { RuntimeDeps } from "../app/types.js";
import { RuntimeStore } from "../app/runtime-store.js";
import { AppError } from "../shared/errors.js";
import {
  buildDownstreamHeaders,
  buildUpstreamUrl,
  collectBody,
  collectHeaders,
  collectQuery,
  stripHeaders,
  REQUEST_STRIP_HEADERS,
} from "../shared/http.js";

export class ProxyService {
  constructor(
    private readonly deps: RuntimeDeps,
    private readonly runtime: RuntimeStore,
  ) {}

  matchIncomingUrl(rawUrl: string): URL | null {
    const incomingUrl = new URL(rawUrl);
    if (!this.deps.config.proxyPrefixEnabled) {
      return incomingUrl;
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

    return incomingUrl;
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
      this.deps.config.bodyLimit,
    );
    const requestHeaders = collectHeaders(request.headers);
    const query = collectQuery(incomingUrl);

    const upstreamRequestHeaders = stripHeaders(request.headers, REQUEST_STRIP_HEADERS);
    upstreamRequestHeaders.delete("accept-encoding");

    const upstreamRequest: RequestInit = {
      method,
      headers: upstreamRequestHeaders,
      redirect: "manual",
    };
    if (method !== "GET" && method !== "HEAD" && requestBytes.length > 0) {
      upstreamRequest.body = requestBytes;
    }

    try {
      const upstreamResponse = await this.deps.fetch(upstreamUrl, upstreamRequest);
      const responseContentLengthRaw =
        upstreamResponse.headers.get("content-length");
      const responseContentLength = responseContentLengthRaw
        ? Number(responseContentLengthRaw)
        : Number.NaN;

      if (
        Number.isFinite(responseContentLength) &&
        responseContentLength > this.deps.config.responseBufferLimit
      ) {
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
            responseBody: {
              text: null,
              size: responseContentLength,
              truncated: true,
              isBinary: true,
              format: "binary",
            },
            durationMs: this.deps.now() - startedAtMs,
            error: null,
          }),
        );

        return new Response(upstreamResponse.body, {
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
        upstreamResponse.headers.get("content-type"),
        this.deps.config.bodyLimit,
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
      const message = error instanceof Error ? error.message : "Unknown proxy error";
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
        { message: "Proxy forwarding failed.", error: message },
        { status: 502 },
      );
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
