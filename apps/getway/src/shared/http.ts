import type {
  ProxyHeaders,
  ProxyPayloadBody,
  ProxyQueryParams,
  BodyFormat,
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
  // `Expect: 100-continue` is a per-hop expectation: the client is asking *this*
  // hop whether it may send the body, and Node's HTTP server already answered
  // 100 Continue before we ever saw the bytes. Forwarding it hands undici a
  // handshake it refuses to perform — `new Request` throws UND_ERR_NOT_SUPPORTED
  // ("expect header not supported") and the whole forward dies as a 502. This
  // is exactly the shape of a large POST from curl, which adds the header
  // automatically past ~1KB.
  "expect",
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
  "application/yaml",
  "application/x-yaml",
  "text/yaml",
]);

const STREAMING_MIME_TYPES = new Set([
  "text/event-stream",
  "multipart/x-mixed-replace",
]);

const textDecoder = new TextDecoder();

export const isStreamingContentType = (contentType: string | null): boolean => {
  if (!contentType) {
    return false;
  }
  const mimeType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return STREAMING_MIME_TYPES.has(mimeType);
};

// Statuses that must not carry a body: passing even an empty Uint8Array makes
// the Response constructor throw ("Invalid response status code"), which used
// to surface as a bogus 502 for every 204 DELETE and 304 revalidation.
const BODILESS_STATUS_CODES = new Set([101, 204, 205, 304]);

export const isBodilessStatus = (status: number): boolean =>
  BODILESS_STATUS_CODES.has(status);

// A request asking to switch protocols (WebSocket handshake, h2c, ...).
// Forwarding is built on fetch(), which can never complete an upgrade: it has
// no way to hand back the socket behind a 101 response. Detect these up front
// so we can refuse them outright instead of silently stripping the hop-by-hop
// headers and turning the handshake into a plain GET.
export const describeUpgradeProtocol = (headers: Headers): string | null => {
  const upgrade = headers.get("upgrade")?.trim();
  if (!upgrade) {
    return null;
  }
  const connection = headers.get("connection")?.toLowerCase() ?? "";
  const wantsUpgrade = connection
    .split(",")
    .some((token) => token.trim() === "upgrade");
  if (!wantsUpgrade) {
    return null;
  }
  return upgrade.toLowerCase();
};

// Tabular payloads are labelled up front so the dashboard can render them as
// a table without guessing from the raw text.
const looksLikeCsv = (text: string): boolean => {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return false;
  }

  const sample = lines.slice(0, 5);
  const delimiter = sample.some((line) => line.includes("\t"))
    ? "\t"
    : sample.some((line) => line.includes(","))
      ? ","
      : "";
  if (!delimiter) {
    return false;
  }

  const widths = sample.map((line) => line.split(delimiter).length);
  return Math.min(...widths) > 1 && Math.max(...widths) - Math.min(...widths) <= 1;
};

const detectBodyFormat = (
  bytes: Uint8Array,
  contentType: string | null,
  isBinary: boolean,
): BodyFormat => {
  if (isBinary || bytes.length === 0) {
    return "binary";
  }

  const mimeType = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";

  // Check by Content-Type first
  if (mimeType.includes("json") || mimeType.endsWith("+json")) {
    return "json";
  }
  if (mimeType.includes("xml") || mimeType.endsWith("+xml")) {
    return "xml";
  }
  if (mimeType.includes("x-www-form-urlencoded")) {
    return "form-urlencoded";
  }
  if (mimeType.includes("html")) {
    return "html";
  }
  if (mimeType.includes("yaml") || mimeType.includes("yml")) {
    return "yaml";
  }
  if (mimeType.includes("csv") || mimeType.includes("tab-separated-values")) {
    return "csv";
  }

  // Check by content sniffing
  const preview = textDecoder.decode(bytes.slice(0, 100)).trimStart();

  if (preview.startsWith("{") || preview.startsWith("[")) {
    return "json";
  }
  if (preview.startsWith("<?xml") || preview.startsWith("<")) {
    // Check if it looks like HTML (has common HTML tags)
    const lowerPreview = preview.toLowerCase();
    if (
      lowerPreview.includes("<!doctype html") ||
      lowerPreview.includes("<html") ||
      lowerPreview.includes("<head") ||
      lowerPreview.includes("<body")
    ) {
      return "html";
    }
    return "xml";
  }
  if (preview.startsWith("---")) {
    return "yaml";
  }
  // Check if it looks like form-urlencoded (key=value&...)
  if (preview.includes("=") && !preview.includes(" ")) {
    const hasAmpersand = preview.includes("&");
    const firstEquals = preview.indexOf("=");
    if (firstEquals > 0 && (hasAmpersand || preview.length < 1000)) {
      return "form-urlencoded";
    }
  }

  if (looksLikeCsv(textDecoder.decode(bytes.slice(0, 4096)))) {
    return "csv";
  }

  return "text";
};

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
  maxCaptureBytes: number,
): ProxyPayloadBody => {
  if (bytes.length === 0) {
    return {
      text: null,
      size: 0,
      truncated: false,
      isBinary: false,
      format: "text",
    };
  }

  const isBinary = !isTextualContentType(contentType);
  const format = detectBodyFormat(bytes, contentType, isBinary);

  // 0 = 不限（PROXY_MAX_BODY_CAPTURE_BYTES=0），与流式上限同一套语义。
  const limit = maxCaptureBytes > 0 ? maxCaptureBytes : Number.MAX_SAFE_INTEGER;
  const captured = bytes.length > limit ? bytes.slice(0, limit) : bytes;

  if (isBinary) {
    // Binary payloads cannot be parsed, but the raw bytes are still the only
    // forensic trace of a failed request (e.g. an SSE stream that dies with an
    // opaque error body). Keep a lossy UTF-8 preview so users can at least see
    // what the upstream actually returned.
    return {
      text: textDecoder.decode(captured),
      size: bytes.length,
      truncated: captured.length < bytes.length,
      isBinary: true,
      format,
    };
  }

  return {
    text: textDecoder.decode(captured),
    size: bytes.length,
    truncated: captured.length < bytes.length,
    isBinary: false,
    format,
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
