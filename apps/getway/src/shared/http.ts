import type {
  ProxyHeaders,
  ProxyPayloadBody,
  ProxyQueryParams,
} from "@proxira/core";

const RESPONSE_HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
] as const;

export const REQUEST_STRIP_HEADERS = [
  ...RESPONSE_HOP_BY_HOP_HEADERS,
  "host",
  "content-length",
] as const;

const TEXTUAL_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/problem+json",
  "application/xml",
  "application/javascript",
  "application/ecmascript",
  "application/graphql-response+json",
  "application/x-www-form-urlencoded",
  "application/graphql",
  "application/x-ndjson",
]);

const textDecoder = new TextDecoder();

const isTextualContentType = (contentType: string | null): boolean => {
  if (!contentType) {
    return true;
  }

  const mimeType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mimeType) {
    return true;
  }

  if (mimeType.startsWith("text/")) {
    return true;
  }
  if (TEXTUAL_MIME_TYPES.has(mimeType)) {
    return true;
  }

  return mimeType.endsWith("+json") || mimeType.endsWith("+xml");
};

export const collectHeaders = (headers: Headers): ProxyHeaders => {
  const result: ProxyHeaders = {};
  headers.forEach((value, key) => {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
      return;
    }
    if (Array.isArray(existing)) {
      existing.push(value);
      return;
    }
    result[key] = [existing, value];
  });

  const setCookieReader = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof setCookieReader.getSetCookie === "function") {
    const setCookies = setCookieReader.getSetCookie();
    if (setCookies.length > 0) {
      const firstSetCookie = setCookies[0];
      if (firstSetCookie) {
        result["set-cookie"] = setCookies.length === 1 ? firstSetCookie : setCookies;
      }
    }
  }

  return result;
};

export const collectQuery = (url: URL): ProxyQueryParams => {
  const result: ProxyQueryParams = {};
  for (const [key, value] of url.searchParams.entries()) {
    const current = result[key];
    if (current === undefined) {
      result[key] = value;
      continue;
    }
    if (Array.isArray(current)) {
      current.push(value);
      continue;
    }
    result[key] = [current, value];
  }
  return result;
};

export const collectBody = (
  bytes: Uint8Array,
  contentType: string | null,
  bodyLimit: number,
): ProxyPayloadBody => {
  if (bytes.length === 0) {
    return {
      text: null,
      size: 0,
      truncated: false,
      isBinary: false,
    };
  }

  const isBinary = !isTextualContentType(contentType);
  if (isBinary) {
    return {
      text: null,
      size: bytes.length,
      truncated: false,
      isBinary: true,
    };
  }

  const truncated = bytes.length > bodyLimit;
  const visibleBytes = truncated ? bytes.slice(0, bodyLimit) : bytes;
  return {
    text: textDecoder.decode(visibleBytes),
    size: bytes.length,
    truncated,
    isBinary: false,
  };
};

export const stripHeaders = (headers: Headers, keys: readonly string[]): Headers => {
  const sanitized = new Headers(headers);
  for (const header of keys) {
    sanitized.delete(header);
  }
  return sanitized;
};

export const buildUpstreamUrl = (targetBaseUrl: string, incomingUrl: URL): URL => {
  const upstreamUrl = new URL(targetBaseUrl);
  const basePath = upstreamUrl.pathname === "/" ? "" : upstreamUrl.pathname.replace(/\/$/, "");
  const requestPath = incomingUrl.pathname.startsWith("/")
    ? incomingUrl.pathname
    : `/${incomingUrl.pathname}`;

  upstreamUrl.pathname = `${basePath}${requestPath}` || "/";
  upstreamUrl.search = incomingUrl.search;
  return upstreamUrl;
};

export const buildDownstreamHeaders = (
  upstreamHeaders: Headers,
  method: string,
  bodyLength?: number,
): Headers => {
  const downstreamHeaders = stripHeaders(upstreamHeaders, RESPONSE_HOP_BY_HOP_HEADERS);
  if (downstreamHeaders.has("content-encoding")) {
    downstreamHeaders.delete("content-encoding");
    downstreamHeaders.delete("content-length");
  }
  if (method !== "HEAD" && Number.isFinite(bodyLength)) {
    downstreamHeaders.set("content-length", String(bodyLength));
  }
  return downstreamHeaders;
};
