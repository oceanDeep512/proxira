import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";
import boxen from "boxen";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ProxyConfig,
  ProxyHeaders,
  ProxyPayloadBody,
  ProxyQueryParams,
  ProxyRecordDetailResponse,
  ProxyRecordsExportResponse,
  ProxyRecordsResponse,
  ProxyServerStatus,
  ProxySseEvent,
  ProxyTrafficRecord,
} from "@proxira/core";
import { PROXIRA_LOGO_LINES } from "./logo.js";

const app = new Hono();
const encoder = new TextEncoder();
const textDecoder = new TextDecoder();
const moduleDir = dirname(fileURLToPath(import.meta.url));
const startedAt = Date.now();

const SERVER_PORT = Number(process.env.PORT ?? 3000);
const BODY_LIMIT = Number(process.env.PROXY_BODY_LIMIT ?? 32_768);
const MAX_QUERY_LIMIT = Number(process.env.PROXY_QUERY_LIMIT_MAX ?? 500);
const SSE_HEARTBEAT_MS = Number(process.env.PROXY_SSE_HEARTBEAT_MS ?? 15_000);
const HISTORY_LIMIT_RAW = Number(process.env.PROXY_HISTORY_LIMIT ?? 1_000);
const DISABLE_STARTUP_BANNER = process.env.PROXY_DISABLE_BANNER === "1";
const HISTORY_LIMIT = Number.isFinite(HISTORY_LIMIT_RAW)
  ? Math.max(1, Math.floor(HISTORY_LIMIT_RAW))
  : 1_000;

const DATA_DIR = resolve(process.env.PROXY_DATA_DIR?.trim() || join(process.cwd(), ".proxira"));
const CONFIG_FILE = join(DATA_DIR, "config.json");

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

const REQUEST_STRIP_HEADERS = [...RESPONSE_HOP_BY_HOP_HEADERS, "host", "content-length"] as const;

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

type SseClient = {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeatTimer: ReturnType<typeof setInterval>;
};

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

const proxyConfig: ProxyConfig = {
  targetBaseUrl: process.env.PROXY_TARGET_URL?.trim() || "http://localhost:8080",
};

const history: ProxyTrafficRecord[] = [];
const sseClients = new Map<string, SseClient>();
let persistQueue = Promise.resolve();

const resolveDashboardDistDir = (): string | null => {
  const fromEnv = process.env.DASHBOARD_DIST_DIR?.trim();
  const candidates = [
    fromEnv ? resolve(fromEnv) : null,
    resolve(moduleDir, "../dashboard-dist"),
    resolve(moduleDir, "../../dashboard/dist"),
    resolve(process.cwd(), "../dashboard/dist"),
    resolve(process.cwd(), "dashboard-dist"),
    resolve(process.cwd(), "apps/dashboard/dist"),
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
};

const dashboardDistDir = resolveDashboardDistDir();

const resolveDashboardAssetPath = (requestPath: string): string | null => {
  if (!dashboardDistDir) {
    return null;
  }

  const normalized = requestPath.replace(/^\/_proxira\/ui\/?/, "").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    return null;
  }

  if (normalized.length === 0) {
    return join(dashboardDistDir, "index.html");
  }

  const filePath = join(dashboardDistDir, normalized);
  if (existsSync(filePath)) {
    return filePath;
  }

  if (extname(normalized).length > 0) {
    return null;
  }

  return join(dashboardDistDir, "index.html");
};

const sendEventChunk = (event: ProxySseEvent): Uint8Array => {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
};

const normalizeTargetBaseUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
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
  if (mimeType.endsWith("+json") || mimeType.endsWith("+xml")) {
    return true;
  }
  return false;
};

const collectHeaders = (headers: Headers): ProxyHeaders => {
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

const collectQuery = (url: URL): ProxyQueryParams => {
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

const collectBody = (bytes: Uint8Array, contentType: string | null): ProxyPayloadBody => {
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

  const truncated = bytes.length > BODY_LIMIT;
  const visibleBytes = truncated ? bytes.slice(0, BODY_LIMIT) : bytes;
  return {
    text: textDecoder.decode(visibleBytes),
    size: bytes.length,
    truncated,
    isBinary: false,
  };
};

const stripHeaders = (headers: Headers, keys: readonly string[]): Headers => {
  const sanitized = new Headers(headers);
  for (const header of keys) {
    sanitized.delete(header);
  }
  return sanitized;
};

const buildUpstreamUrl = (targetBaseUrl: string, incomingUrl: URL): URL => {
  const upstreamUrl = new URL(targetBaseUrl);
  const basePath = upstreamUrl.pathname === "/" ? "" : upstreamUrl.pathname.replace(/\/$/, "");
  const requestPath = incomingUrl.pathname.startsWith("/")
    ? incomingUrl.pathname
    : `/${incomingUrl.pathname}`;
  upstreamUrl.pathname = `${basePath}${requestPath}` || "/";
  upstreamUrl.search = incomingUrl.search;
  return upstreamUrl;
};

const removeSseClient = (clientId: string): void => {
  const client = sseClients.get(clientId);
  if (!client) {
    return;
  }

  clearInterval(client.heartbeatTimer);
  sseClients.delete(clientId);
  try {
    client.controller.close();
  } catch {
    // Stream may already be closed by client.
  }
};

const broadcastEvent = (event: ProxySseEvent): void => {
  const chunk = sendEventChunk(event);
  for (const [clientId, client] of sseClients) {
    try {
      client.controller.enqueue(chunk);
    } catch {
      removeSseClient(clientId);
    }
  }
};

const enqueuePersist = (task: () => Promise<void>): void => {
  persistQueue = persistQueue.then(task).catch((error) => {
    console.error("[persist]", error instanceof Error ? error.message : error);
  });
};

const saveJsonFile = async (filePath: string, data: unknown): Promise<void> => {
  const payload = JSON.stringify(data, null, 2);
  await writeFile(filePath, payload, "utf8");
};

const saveConfig = (): void => {
  enqueuePersist(async () => {
    await saveJsonFile(CONFIG_FILE, proxyConfig);
  });
};

const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const payload = await readFile(filePath, "utf8");
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
};

const addHistoryRecord = (record: ProxyTrafficRecord): void => {
  history.unshift(record);
  broadcastEvent({ type: "record", record });
  while (history.length > HISTORY_LIMIT) {
    const removed = history.pop();
    if (removed) {
      broadcastEvent({ type: "record_deleted", id: removed.id });
    }
  }
};

const filterRecords = (
  methodRaw: string | undefined,
  pathRaw: string | undefined,
  statusRaw: string | undefined,
): ProxyTrafficRecord[] => {
  let filtered = history;
  if (methodRaw) {
    filtered = filtered.filter((item) => item.method === methodRaw);
  }
  if (pathRaw) {
    filtered = filtered.filter((item) => item.path.includes(pathRaw));
  }
  if (statusRaw) {
    if (statusRaw === "error") {
      filtered = filtered.filter((item) => item.error !== null);
    } else {
      const statusCode = Number(statusRaw);
      if (Number.isFinite(statusCode)) {
        filtered = filtered.filter((item) => item.responseStatus === statusCode);
      }
    }
  }
  return filtered;
};

const hydrateState = async (): Promise<void> => {
  await mkdir(DATA_DIR, { recursive: true });

  const fileConfig = await readJsonFile<Partial<ProxyConfig>>(CONFIG_FILE);
  const normalizedTarget = fileConfig?.targetBaseUrl
    ? normalizeTargetBaseUrl(fileConfig.targetBaseUrl)
    : null;
  if (normalizedTarget) {
    proxyConfig.targetBaseUrl = normalizedTarget;
  }

};

const printStartupTips = (port: number): void => {
  const proxyUrl = `http://localhost:${port}`;
  const dashboardUrl = `${proxyUrl}/_proxira/ui`;
  const tips = [
    chalk.bold("使用说明"),
    `1) 将你要联调的 SDK/应用请求地址指向 ${chalk.cyan(proxyUrl)}`,
    `2) 在浏览器打开 ${chalk.cyan(dashboardUrl)} 查看请求和响应详情`,
    `3) 通过面板可修改上游地址，当前生效值为 ${chalk.green(proxyConfig.targetBaseUrl)}`,
    `4) 仅建议本地开发使用，请勿直接暴露到公网`,
  ];

  if (process.env.PROXY_CLI_MODE === "1") {
    tips.push(
      "",
      chalk.bold("CLI 示例"),
      "  proxira --port 3010 --target http://localhost:8080",
      "  proxira -p 3001 -d ./.proxira",
      "  proxira --help",
    );
  }

  console.log(`\n${tips.join("\n")}`);
};

const printStartupInfo = (port: number): void => {
  const proxyUrl = `http://localhost:${port}`;
  const dashboardUrl = `${proxyUrl}/_proxira/ui`;

  if (DISABLE_STARTUP_BANNER) {
    console.log(`代理服务已启动：${proxyUrl}`);
    console.log(`当前上游地址：${proxyConfig.targetBaseUrl}`);
    console.log(`数据目录：${DATA_DIR}`);
    console.log(`历史记录上限：${HISTORY_LIMIT}`);
    if (dashboardDistDir) {
      console.log(`管理面板：${dashboardUrl}`);
    } else {
      console.log(
        "未检测到管理面板构建产物，请先执行 `pnpm --filter @proxira/dashboard build`。",
      );
    }
    printStartupTips(port);
    return;
  }

  const logo = PROXIRA_LOGO_LINES.map((line, index) =>
    [chalk.cyanBright, chalk.blueBright, chalk.magentaBright][index % 3]!(line),
  ).join("\n");

  const summary = [
    logo,
    "",
    `${chalk.bold("Proxy")}: ${chalk.cyan(proxyUrl)}`,
    `${chalk.bold("Dashboard")}: ${
      dashboardDistDir
        ? chalk.cyan(dashboardUrl)
        : chalk.yellow("not found (run dashboard build)")
    }`,
    `${chalk.bold("Target")}: ${chalk.green(proxyConfig.targetBaseUrl)}`,
    `${chalk.bold("History Limit")}: ${chalk.gray(String(HISTORY_LIMIT))}`,
    `${chalk.bold("Data Dir")}: ${chalk.gray(DATA_DIR)}`,
  ].join("\n");

  console.log(
    boxen(summary, {
      title: ` ${chalk.bold(chalk.cyan("Proxira"))} `,
      titleAlignment: "center",
      borderColor: "cyan",
      borderStyle: "round",
      padding: { top: 0, right: 1, bottom: 0, left: 1 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }),
  );
  printStartupTips(port);
};

app.use("/_proxira/*", cors());

app.get("/_proxira/api/health", (c) => {
  return c.json({ ok: true, at: new Date().toISOString() });
});

app.get("/_proxira/api/status", (c) => {
  const payload: ProxyServerStatus = {
    startedAt: new Date(startedAt).toISOString(),
    uptimeMs: Date.now() - startedAt,
    config: proxyConfig,
    historySize: history.length,
    sseClients: sseClients.size,
  };
  return c.json(payload);
});

app.get("/_proxira/api/config", (c) => c.json(proxyConfig));

app.put("/_proxira/api/config", async (c) => {
  let payload: Partial<ProxyConfig>;
  try {
    payload = await c.req.json<Partial<ProxyConfig>>();
  } catch {
    return c.json({ message: "Invalid JSON payload." }, 400);
  }

  const normalized = payload.targetBaseUrl
    ? normalizeTargetBaseUrl(payload.targetBaseUrl)
    : null;
  if (!normalized) {
    return c.json({ message: "targetBaseUrl must be a valid HTTP/HTTPS URL." }, 400);
  }

  proxyConfig.targetBaseUrl = normalized;
  saveConfig();
  broadcastEvent({ type: "config", config: proxyConfig });
  return c.json(proxyConfig);
});

app.get("/_proxira/api/records", (c) => {
  const limitRaw = Number(c.req.query("limit") ?? "50");
  const offsetRaw = Number(c.req.query("offset") ?? "0");
  const methodRaw = c.req.query("method")?.trim().toUpperCase();
  const pathRaw = c.req.query("path")?.trim();
  const statusRaw = c.req.query("status")?.trim();

  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, MAX_QUERY_LIMIT))
    : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

  const filtered = filterRecords(methodRaw, pathRaw, statusRaw);

  const payload: ProxyRecordsResponse = {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
  };
  return c.json(payload);
});

app.get("/_proxira/api/records/export", (c) => {
  const methodRaw = c.req.query("method")?.trim().toUpperCase();
  const pathRaw = c.req.query("path")?.trim();
  const statusRaw = c.req.query("status")?.trim();
  const filtered = filterRecords(methodRaw, pathRaw, statusRaw);

  const payload: ProxyRecordsExportResponse = {
    exportedAt: new Date().toISOString(),
    total: filtered.length,
    items: filtered,
  };
  const fileToken = payload.exportedAt.replace(/[:.]/g, "-");
  const fileName = `proxira-records-${fileToken}.json`;

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});

app.get("/_proxira/api/records/:id", (c) => {
  const record = history.find((item) => item.id === c.req.param("id")) ?? null;
  const payload: ProxyRecordDetailResponse = { item: record };
  if (!record) {
    return c.json(payload, 404);
  }
  return c.json(payload);
});

app.delete("/_proxira/api/records/:id", (c) => {
  const recordId = c.req.param("id");
  const targetIndex = history.findIndex((item) => item.id === recordId);
  if (targetIndex === -1) {
    return c.json({ removed: false, id: recordId }, 404);
  }

  history.splice(targetIndex, 1);
  broadcastEvent({ type: "record_deleted", id: recordId });
  return c.json({ removed: true, id: recordId });
});

app.delete("/_proxira/api/records", (c) => {
  const removed = history.length;
  history.length = 0;
  broadcastEvent({ type: "records_cleared" });
  return c.json({ cleared: removed });
});

app.get("/_proxira/api/events", (c) => {
  const clientId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(sendEventChunk({ type: "heartbeat", at: new Date().toISOString() }));
        } catch {
          removeSseClient(clientId);
        }
      }, SSE_HEARTBEAT_MS);

      sseClients.set(clientId, { id: clientId, controller, heartbeatTimer });
      controller.enqueue(sendEventChunk({ type: "snapshot", config: proxyConfig }));
    },
    cancel() {
      removeSseClient(clientId);
    },
  });

  c.req.raw.signal.addEventListener("abort", () => {
    removeSseClient(clientId);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

app.get("/_proxira/ui", (c) => c.redirect("/_proxira/ui/"));

app.get("/_proxira/ui/*", async (c) => {
  if (!dashboardDistDir) {
    return c.json(
      {
        message:
          "Dashboard build not found. Run `pnpm --filter @proxira/dashboard build` first.",
      },
      503,
    );
  }

  const filePath = resolveDashboardAssetPath(c.req.path);
  if (!filePath || !existsSync(filePath)) {
    return c.notFound();
  }

  const fileBuffer = await readFile(filePath);
  const contentType = MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  return new Response(fileBuffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": filePath.endsWith(".html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    },
  });
});

app.all("/_proxira/*", (c) => c.notFound());

app.all("*", async (c) => {
  const startedAtMs = Date.now();
  const incomingUrl = new URL(c.req.url);
  const upstreamUrl = buildUpstreamUrl(proxyConfig.targetBaseUrl, incomingUrl);
  const method = c.req.method.toUpperCase();

  const requestBuffer = await c.req.raw
    .clone()
    .arrayBuffer()
    .catch(() => new ArrayBuffer(0));
  const requestBytes = new Uint8Array(requestBuffer);
  const requestBody = collectBody(requestBytes, c.req.header("content-type") ?? null);

  const requestHeaders = collectHeaders(c.req.raw.headers);
  const query = collectQuery(incomingUrl);

  const upstreamRequestHeaders = stripHeaders(c.req.raw.headers, REQUEST_STRIP_HEADERS);
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
    const upstreamResponse = await fetch(upstreamUrl, upstreamRequest);
    const responseBuffer = await upstreamResponse.arrayBuffer().catch(() => new ArrayBuffer(0));
    const responseBytes = new Uint8Array(responseBuffer);

    const responseBody = collectBody(
      responseBytes,
      upstreamResponse.headers.get("content-type"),
    );
    const responseHeaders = collectHeaders(upstreamResponse.headers);

    const record: ProxyTrafficRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      method,
      path: incomingUrl.pathname,
      query,
      requestHeaders,
      requestBody,
      upstreamUrl: upstreamUrl.toString(),
      responseStatus: upstreamResponse.status,
      responseHeaders,
      responseBody,
      durationMs: Date.now() - startedAtMs,
      error: null,
    };

    addHistoryRecord(record);

    const downstreamHeaders = stripHeaders(
      upstreamResponse.headers,
      RESPONSE_HOP_BY_HOP_HEADERS,
    );
    if (downstreamHeaders.has("content-encoding")) {
      downstreamHeaders.delete("content-encoding");
      downstreamHeaders.delete("content-length");
    }
    if (method !== "HEAD") {
      downstreamHeaders.set("content-length", String(responseBytes.byteLength));
    }

    return new Response(responseBytes, {
      status: upstreamResponse.status,
      headers: downstreamHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";

    const record: ProxyTrafficRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      method,
      path: incomingUrl.pathname,
      query,
      requestHeaders,
      requestBody,
      upstreamUrl: upstreamUrl.toString(),
      responseStatus: null,
      responseHeaders: {},
      responseBody: null,
      durationMs: Date.now() - startedAtMs,
      error: message,
    };

    addHistoryRecord(record);

    return c.json({ message: "Proxy forwarding failed.", error: message }, 502);
  }
});

const bootstrap = async (): Promise<void> => {
  await hydrateState();

  serve(
    {
      fetch: app.fetch,
      port: SERVER_PORT,
    },
    (info) => {
      printStartupInfo(info.port);
    },
  );
};

void bootstrap();
