import type {
  ProxyHeaders,
  ProxyPayloadBody,
  ProxyRecordsExportResponse,
  ProxyTrafficRecord,
} from "@proxira/core";
import DOMPurify from "dompurify";
import { marked } from "marked";
import Papa from "papaparse";
import YAML from "js-yaml";
import { XMLParser } from "fast-xml-parser";
import xmlFormat from "xml-formatter";
import { formatBytes, toPrettyJson } from "./format.js";
import { redactJsonValue, redactText } from "./redact.js";

export type SseEventView = {
  event: string;
  id: string | null;
  data: string;
  jsonData: unknown | null;
};

export type BodyView = {
  mode:
    | "empty"
    | "binary"
    | "json"
    | "xml"
    | "form-urlencoded"
    | "html"
    | "yaml"
    | "text"
    | "csv"
    | "markdown"
    | "sse";
  jsonData: unknown | null;
  text: string;
  note: string;
  truncated: boolean;
  previewHtml: string;
  sseEvents: SseEventView[] | null;
  csvTable: {
    headers: string[];
    rows: string[][];
    totalRows: number;
    visibleRows: number;
  } | null;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
});

marked.setOptions({
  gfm: true,
  breaks: true,
  async: false,
});

export const resolveContentType = (
  headers: ProxyHeaders | null | undefined,
): string => {
  if (!headers) {
    return "";
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "content-type") {
      continue;
    }
    const raw = Array.isArray(value) ? value[0] : value;
    if (!raw) {
      return "";
    }
    return raw.split(";")[0]?.trim().toLowerCase() ?? "";
  }
  return "";
};

const appendBodyNote = (primary: string, secondary: string): string => {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return `${primary} · ${secondary}`;
};

const safeParseJson = (text: string): unknown | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// Best effort repair for payloads that were cut off mid-structure: close the
// unclosed brackets/braces so the JSON tree can still be rendered.
const tryFixTruncatedJson = (text: string): unknown | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to fix attempts
  }

  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.length > 0 && stack[stack.length - 1] === expected) {
        stack.pop();
      }
    }
  }

  if (stack.length === 0) {
    return null;
  }

  let fixed = trimmed;
  if (inString) {
    fixed += '"';
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    fixed += stack[i] === "{" ? "}" : "]";
  }

  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
};

const fallbackFormatXml = (xmlStr: string): string => {
  let formatted = "";
  let indent = 0;
  const tab = "  ";

  xmlStr = xmlStr.trim().replace(/>\s*</g, "><");
  const tokens = xmlStr.split(/(<[^>]+>)/g).filter((token) => token.trim());

  for (const token of tokens) {
    if (token.match(/^<\//)) {
      indent = Math.max(0, indent - 1);
      formatted += tab.repeat(indent) + token + "\n";
    } else if (token.match(/^<[^/][^>]*[^/]>$/) && !token.match(/^<!/)) {
      formatted += tab.repeat(indent) + token + "\n";
      indent++;
    } else if (token.match(/^<[^/][^>]*\/>$/) || token.match(/^</)) {
      formatted += tab.repeat(indent) + token + "\n";
    } else {
      formatted += tab.repeat(indent) + token + "\n";
    }
  }

  return formatted.trimEnd();
};

const formatXmlContent = (source: string): string => {
  try {
    return xmlFormat(source, {
      indentation: "  ",
      collapseContent: true,
      lineSeparator: "\n",
    });
  } catch {
    return fallbackFormatXml(source);
  }
};

const safeParseXml = (source: string): unknown | null => {
  try {
    return xmlParser.parse(source);
  } catch {
    return null;
  }
};

const safeParseYaml = (source: string): unknown | null => {
  try {
    const parsed = YAML.load(source);
    return parsed === undefined ? null : parsed;
  } catch {
    return null;
  }
};

const parseFormUrlEncoded = (text: string): Record<string, string | string[]> => {
  const result: Record<string, string | string[]> = {};
  const pairs = text.split("&");
  for (const pair of pairs) {
    const [rawKey, rawValue] = pair.split("=", 2);
    if (!rawKey) continue;
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      const value =
        rawValue !== undefined ? decodeURIComponent(rawValue.replace(/\+/g, " ")) : "";
      const existing = result[key];
      if (existing === undefined) {
        result[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    } catch {
      // Skip invalid pairs
    }
  }
  return result;
};

const sanitizeHtml = (source: string): string =>
  DOMPurify.sanitize(source, {
    USE_PROFILES: { html: true },
  });

// Server-Sent Events sniffing: a payload is treated as SSE when the
// Content-Type says so, or when its shape matches field-line blocks.
const looksLikeSse = (text: string): boolean => {
  if (!text.includes("\n")) {
    return false;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) {
    return false;
  }
  const fieldLines = lines.filter((line) => /^(data|event|id|retry):/.test(line));
  return (
    fieldLines.length >= 2 ||
    (fieldLines.length === lines.length && lines[0].startsWith("data:"))
  );
};

// Parse an SSE payload into per-event views. Each `data:` line that is valid
// JSON gets rendered as a tree; anything else stays raw text.
const parseSseEvents = (text: string): SseEventView[] => {
  const blocks = text.split(/\r?\n\r?\n/);
  const events: SseEventView[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const dataLines: string[] = [];
    let eventName = "message";
    let eventId: string | null = null;
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      } else if (line.startsWith("event:")) {
        const value = line.slice(6).replace(/^ /, "").trim();
        if (value) {
          eventName = value;
        }
      } else if (line.startsWith("id:")) {
        const value = line.slice(3).replace(/^ /, "").trim();
        if (value) {
          eventId = value;
        }
      }
      // comment (":...") and retry lines are ignored for display
    }
    if (dataLines.length === 0) {
      continue;
    }
    const data = dataLines.join("\n");
    events.push({
      event: eventName,
      id: eventId,
      data,
      jsonData: safeParseJson(data),
    });
  }
  return events;
};

const detectLikelyCsv = (text: string, contentType: string): boolean => {
  if (contentType.includes("csv") || contentType.includes("tab-separated-values")) {
    return true;
  }

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
  const min = Math.min(...widths);
  const max = Math.max(...widths);
  return min > 1 && max - min <= 1;
};

const parseCsvTable = (
  text: string,
): {
  headers: string[];
  rows: string[][];
  totalRows: number;
  visibleRows: number;
} | null => {
  const tryParse = (delimiter?: "," | "\t"): string[][] => {
    const parsed = delimiter
      ? Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimiter })
      : Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    return parsed.data;
  };

  let rows = tryParse();
  let maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (maxColumns <= 1) {
    rows = tryParse("\t");
    maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  }
  if (!rows.length || maxColumns <= 1) {
    return null;
  }

  const normalizedRows = rows.map((row) =>
    Array.from({ length: maxColumns }, (_, index) => row[index] ?? ""),
  );
  const hasHeader =
    normalizedRows.length > 1 && normalizedRows[0].some((cell) => cell.trim().length > 0);
  const headers = hasHeader
    ? normalizedRows[0]
    : Array.from({ length: maxColumns }, (_, index) => `Column ${index + 1}`);
  const tableRows = hasHeader ? normalizedRows.slice(1) : normalizedRows;

  return {
    headers,
    rows: tableRows,
    totalRows: tableRows.length,
    visibleRows: tableRows.length,
  };
};

const detectLikelyMarkdown = (text: string, contentType: string): boolean => {
  if (contentType.includes("markdown")) {
    return true;
  }
  if (text.length > 500_000) {
    return false;
  }
  return /(^|\n)(#{1,6}\s+\S+|[-*+]\s+\S+|>\s+\S+|\d+\.\s+\S+|```)/.test(text);
};

const renderMarkdownPreview = (source: string): string => {
  const rendered = marked.parse(source);
  const html = typeof rendered === "string" ? rendered : "";
  return sanitizeHtml(html);
};

const buildSseView = (
  text: string,
  note: string,
  truncated: boolean,
): BodyView => ({
  mode: "sse",
  jsonData: null,
  text,
  note,
  truncated,
  previewHtml: "",
  sseEvents: parseSseEvents(text),
  csvTable: null,
});

const bodyModeLabels: Record<BodyView["mode"], string> = {  empty: "空内容",
  binary: "二进制",
  json: "JSON",
  xml: "XML",
  "form-urlencoded": "Form URL Encoded",
  html: "HTML",
  yaml: "YAML",
  text: "Text",
  csv: "CSV",
  markdown: "Markdown",
  sse: "SSE 事件流",
};

export const bodyModeLabel = (body: BodyView): string => bodyModeLabels[body.mode];

export const bodyUsesJsonTree = (body: BodyView): boolean => body.jsonData !== null;

export const bodyUsesSseEvents = (body: BodyView): boolean =>
  body.mode === "sse" && (body.sseEvents?.length ?? 0) > 0;

export const bodyUsesCsvTable = (body: BodyView): boolean =>
  body.mode === "csv" && body.csvTable !== null;

export const bodyUsesRichPreview = (body: BodyView): boolean =>
  (body.mode === "html" || body.mode === "markdown") && body.previewHtml.length > 0;

export const bodyUsesCodeBlock = (body: BodyView): boolean =>
  (body.mode === "xml" || body.mode === "yaml" || body.mode === "html") &&
  body.text.length > 0;

export const bodyHasRawSource = (body: BodyView): boolean =>
  (body.mode === "xml" ||
    body.mode === "yaml" ||
    body.mode === "form-urlencoded" ||
    body.mode === "csv") &&
  body.text.length > 0;

export const bodyCodeClass = (body: BodyView): string =>
  body.mode === "yaml"
    ? "language-yaml"
    : body.mode === "markdown"
      ? "language-markdown"
      : "language-xml";

// Mask credentials inside an already-parsed body view. JSON bodies get key-aware
// masking, everything else falls back to a best-effort text pass. SSE events are
// redacted per-event too, or the event stream would leak what the raw body hides.
export const redactBodyView = (body: BodyView): BodyView => {
  const sseEvents =
    body.sseEvents === null
      ? null
      : body.sseEvents.map((event) => ({
          ...event,
          data: redactText(event.data),
          jsonData: event.jsonData === null ? null : redactJsonValue(event.jsonData),
        }));
  return {
    ...body,
    sseEvents,
    jsonData: body.jsonData === null ? null : redactJsonValue(body.jsonData),
    text: redactText(body.text),
  };
};

export const bodyViewToCopyText = (body: BodyView): string => {
  if (body.mode === "json" || body.mode === "form-urlencoded") {
    return toPrettyJson(body.jsonData ?? {});
  }
  if (
    body.mode === "text" ||
    body.mode === "xml" ||
    body.mode === "html" ||
    body.mode === "yaml" ||
    body.mode === "csv" ||
    body.mode === "markdown" ||
    body.mode === "sse"
  ) {
    return body.text;
  }
  return body.note;
};

export const parseBody = (
  body: ProxyPayloadBody | null,
  headers: ProxyHeaders | null | undefined,
): BodyView => {
  // A streaming response is recorded as a null body: buffering it would hang
  // the request, so tell the user why there is nothing to show.
  if (!body) {
    const isStream = resolveContentType(headers).includes("event-stream");
    return {
      mode: "empty",
      jsonData: null,
      text: "",
      note: isStream ? "流式响应未捕获正文" : "(empty)",
      truncated: false,
      previewHtml: "",
      sseEvents: null,
      csvTable: null,
    };
  }

  if (body.text === null) {
    return {
      mode: body.isBinary ? "binary" : "empty",
      jsonData: null,
      text: "",
      note: body.isBinary ? `binary body (${body.size} bytes)` : "(empty)",
      truncated: false,
      previewHtml: "",
      sseEvents: null,
      csvTable: null,
    };
  }

  const contentType = resolveContentType(headers);
  const truncatedNote = body.truncated
    ? `已截断，原始 ${formatBytes(body.size)}`
    : "";
  const trimmedText = body.text.trimStart();
  const lowerTrimmed = trimmedText.toLowerCase();

  // The backend now keeps a lossy UTF-8 preview even for binary payloads, so
  // try to salvage structured content (e.g. an SSE stream that failed with an
  // opaque content-type) before falling back to a raw preview.
  if (body.isBinary) {
    if (looksLikeSse(body.text)) {
      return buildSseView(
        body.text,
        appendBodyNote("二进制标记 · 内容已按 SSE 事件流解析", truncatedNote),
        body.truncated,
      );
    }
    return {
      mode: "text",
      jsonData: null,
      text: body.text,
      note: appendBodyNote(
        `二进制内容 · 按 UTF-8 文本预览（${formatBytes(body.size)}）`,
        truncatedNote,
      ),
      truncated: body.truncated,
      previewHtml: "",
      sseEvents: null,
      csvTable: null,
    };
  }

  // SSE is decided up front: content-type wins, and the payload shape never
  // matches any other parser anyway.
  if (
    contentType.includes("event-stream") ||
    looksLikeSse(body.text)
  ) {
    return buildSseView(
      body.text,
      appendBodyNote(
        contentType.includes("event-stream")
          ? "已按 SSE 事件流解析"
          : "按内容识别为 SSE 事件流",
        truncatedNote,
      ),
      body.truncated,
    );
  }

  const looksLikeHtml =
    lowerTrimmed.startsWith("<!doctype html") ||
    lowerTrimmed.includes("<html") ||
    lowerTrimmed.includes("<head") ||
    lowerTrimmed.includes("<body");
  const looksLikeXml =
    trimmedText.startsWith("<?xml") ||
    (trimmedText.startsWith("<") && !looksLikeHtml);
  const looksLikeYaml = trimmedText.startsWith("---");

  // Prefer the format detected by backend
  switch (body.format) {
    case "json": {
      let jsonData = safeParseJson(body.text);
      if (jsonData === null && body.truncated) {
        jsonData = tryFixTruncatedJson(body.text);
      }
      if (jsonData !== null) {
        return {
          mode: "json",
          jsonData,
          text: "",
          note: truncatedNote,
          truncated: body.truncated,
          previewHtml: "",
          sseEvents: null,
          csvTable: null,
        };
      }
      break;
    }
    case "form-urlencoded": {
      const parsed = parseFormUrlEncoded(body.text);
      if (Object.keys(parsed).length > 0) {
        return {
          mode: "form-urlencoded",
          jsonData: parsed,
          text: body.text,
          note: truncatedNote,
          truncated: body.truncated,
          previewHtml: "",
          sseEvents: null,
          csvTable: null,
        };
      }
      break;
    }
    case "xml": {
      const parsed = safeParseXml(body.text);
      return {
        mode: "xml",
        jsonData: parsed,
        text: formatXmlContent(body.text),
        note: appendBodyNote(parsed ? "已结构化展示 XML" : "", truncatedNote),
        truncated: body.truncated,
        previewHtml: "",
        sseEvents: null,
        csvTable: null,
      };
    }
    case "html":
      return {
        mode: "html",
        jsonData: null,
        text: formatXmlContent(body.text),
        note: appendBodyNote("已渲染 HTML 预览", truncatedNote),
        truncated: body.truncated,
        previewHtml: sanitizeHtml(body.text),
        sseEvents: null,
        csvTable: null,
      };
    case "yaml": {
      const parsed = safeParseYaml(body.text);
      return {
        mode: "yaml",
        jsonData: parsed,
        text: body.text,
        note: appendBodyNote(parsed ? "已结构化展示 YAML" : "", truncatedNote),
        truncated: body.truncated,
        previewHtml: "",
        sseEvents: null,
        csvTable: null,
      };
    }
    case "text":
    case "binary":
    default:
      break;
  }

  let jsonData = safeParseJson(body.text);
  if (jsonData === null && body.truncated) {
    jsonData = tryFixTruncatedJson(body.text);
  }
  if (jsonData !== null) {
    return {
      mode: "json",
      jsonData,
      text: "",
      note: appendBodyNote("按内容识别为 JSON", truncatedNote),
      truncated: body.truncated,
      previewHtml: "",
      sseEvents: null,
      csvTable: null,
    };
  }

  if (contentType.includes("x-www-form-urlencoded")) {
    const parsed = parseFormUrlEncoded(body.text);
    if (Object.keys(parsed).length > 0) {
      return {
        mode: "form-urlencoded",
        jsonData: parsed,
        text: body.text,
        note: appendBodyNote("按 Content-Type 解析 Form URL Encoded", truncatedNote),
        truncated: body.truncated,
        previewHtml: "",
        sseEvents: null,
        csvTable: null,
      };
    }
  }

  if (contentType.includes("xml") || looksLikeXml) {
    const parsed = safeParseXml(body.text);
    return {
      mode: "xml",
      jsonData: parsed,
      text: formatXmlContent(body.text),
      note: appendBodyNote(
        parsed ? "按内容识别为 XML（结构化）" : "按内容识别为 XML",
        truncatedNote,
      ),
      truncated: body.truncated,
      previewHtml: "",
      sseEvents: null,
      csvTable: null,
    };
  }

  if (contentType.includes("yaml") || contentType.includes("yml") || looksLikeYaml) {
    const parsed = safeParseYaml(body.text);
    return {
      mode: "yaml",
      jsonData: parsed,
      text: body.text,
      note: appendBodyNote(
        parsed ? "按内容识别为 YAML（结构化）" : "按内容识别为 YAML",
        truncatedNote,
      ),
      truncated: body.truncated,
      previewHtml: "",
      sseEvents: null,
      csvTable: null,
    };
  }

  if (contentType.includes("html") || looksLikeHtml) {
    return {
      mode: "html",
      jsonData: null,
      text: formatXmlContent(body.text),
      note: appendBodyNote("按内容识别为 HTML", truncatedNote),
      truncated: body.truncated,
      previewHtml: sanitizeHtml(body.text),
      sseEvents: null,
      csvTable: null,
    };
  }

  if (detectLikelyCsv(body.text, contentType)) {
    const table = parseCsvTable(body.text);
    if (table) {
      return {
        mode: "csv",
        jsonData: null,
        text: body.text,
        note: appendBodyNote("按内容识别为 CSV，已表格展示", truncatedNote),
        truncated: body.truncated,
        previewHtml: "",
        sseEvents: null,
        csvTable: table,
      };
    }
  }

  if (detectLikelyMarkdown(body.text, contentType)) {
    return {
      mode: "markdown",
      jsonData: null,
      text: body.text,
      note: appendBodyNote("按内容识别为 Markdown，已渲染预览", truncatedNote),
      truncated: body.truncated,
      previewHtml: renderMarkdownPreview(body.text),
      sseEvents: null,
      csvTable: null,
    };
  }

  return {
    mode: "text",
    jsonData: null,
    text: body.text,
    note: truncatedNote,
    truncated: body.truncated,
    previewHtml: "",
    sseEvents: null,
    csvTable: null,
  };
};

export const normalizeExportPayload = (
  raw: unknown,
  fallback: { groupId: string; groupName: string },
): ProxyRecordsExportResponse => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const exportedAtRaw = typeof source.exportedAt === "string" ? source.exportedAt.trim() : "";
  const exportedAt =
    exportedAtRaw.length > 0 && !Number.isNaN(Date.parse(exportedAtRaw))
      ? exportedAtRaw
      : new Date().toISOString();
  const groupId =
    typeof source.groupId === "string" && source.groupId.trim().length > 0
      ? source.groupId.trim()
      : fallback.groupId;
  const groupName =
    typeof source.groupName === "string" && source.groupName.trim().length > 0
      ? source.groupName.trim()
      : fallback.groupName;
  const items = Array.isArray(source.items)
    ? (source.items as ProxyTrafficRecord[])
    : [];
  const totalRaw = typeof source.total === "number" ? source.total : Number.NaN;
  const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : items.length;

  return {
    exportedAt,
    groupId,
    groupName,
    total,
    items,
  };
};
