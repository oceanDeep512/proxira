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
  ProxyGroup,
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
const REQUEST_CONTENT_LENGTH_LIMIT_RAW = Number(process.env.PROXY_REQUEST_CONTENT_LENGTH_LIMIT ?? 10 * 1024 * 1024);
const RESPONSE_BUFFER_LIMIT_RAW = Number(process.env.PROXY_RESPONSE_BUFFER_LIMIT ?? 10 * 1024 * 1024);
const HISTORY_LIMIT_RAW = Number(process.env.PROXY_HISTORY_LIMIT ?? 1_000);
const HISTORY_PERSIST_LIMIT_RAW = Number(process.env.PROXY_HISTORY_PERSIST_LIMIT ?? 200);
const DISABLE_STARTUP_BANNER = process.env.PROXY_DISABLE_BANNER === "1";
const HISTORY_LIMIT = Number.isFinite(HISTORY_LIMIT_RAW)
  ? Math.max(1, Math.floor(HISTORY_LIMIT_RAW))
  : 1_000;
const HISTORY_PERSIST_LIMIT = Number.isFinite(HISTORY_PERSIST_LIMIT_RAW)
  ? Math.max(1, Math.floor(HISTORY_PERSIST_LIMIT_RAW))
  : 200;
const EFFECTIVE_HISTORY_PERSIST_LIMIT = Math.min(HISTORY_LIMIT, HISTORY_PERSIST_LIMIT);
const REQUEST_CONTENT_LENGTH_LIMIT = Number.isFinite(REQUEST_CONTENT_LENGTH_LIMIT_RAW)
  ? Math.max(1, Math.floor(REQUEST_CONTENT_LENGTH_LIMIT_RAW))
  : 10 * 1024 * 1024;
const RESPONSE_BUFFER_LIMIT = Number.isFinite(RESPONSE_BUFFER_LIMIT_RAW)
  ? Math.max(1, Math.floor(RESPONSE_BUFFER_LIMIT_RAW))
  : 10 * 1024 * 1024;

const DATA_DIR = resolve(process.env.PROXY_DATA_DIR?.trim() || join(process.cwd(), ".proxira"));
const CONFIG_FILE = join(DATA_DIR, "config.json");
const HISTORY_FILE = join(DATA_DIR, "history.json");

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

const DEFAULT_TARGET_BASE_URL = process.env.PROXY_TARGET_URL?.trim() || "http://localhost:8080";

const proxyConfig: ProxyConfig = {
  activeGroupId: "",
  groups: [],
  targetBaseUrl: DEFAULT_TARGET_BASE_URL,
};

const historyByGroup = new Map<string, ProxyTrafficRecord[]>();
const sseClients = new Map<string, SseClient>();
let persistQueue = Promise.resolve();
type HistoryFilePayload = Record<string, ProxyTrafficRecord[]>;

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

const createGroup = (name: string, targetBaseUrl: string): ProxyGroup => {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    targetBaseUrl,
  };
};

const normalizeGroupName = (nameRaw: string, fallbackIndex: number): string => {
  const normalized = nameRaw.trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return `分组 ${fallbackIndex}`;
};

const toSafeAsciiToken = (raw: string): string => {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

const encodeFilenameRFC5987 = (raw: string): string => {
  return encodeURIComponent(raw).replace(/['()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  });
};

const listGroupHistorySize = (): number => {
  let total = 0;
  for (const items of historyByGroup.values()) {
    total += items.length;
  }
  return total;
};

const ensureGroupHistory = (groupId: string): ProxyTrafficRecord[] => {
  const existing = historyByGroup.get(groupId);
  if (existing) {
    return existing;
  }

  const created: ProxyTrafficRecord[] = [];
  historyByGroup.set(groupId, created);
  return created;
};

const findGroupById = (groupId: string): ProxyGroup | undefined => {
  return proxyConfig.groups.find((group) => group.id === groupId);
};

const syncConfigTargetBaseUrl = (): void => {
  const activeGroup = findGroupById(proxyConfig.activeGroupId) ?? null;
  proxyConfig.targetBaseUrl = activeGroup?.targetBaseUrl ?? "";
};

const ensureActiveGroup = (): ProxyGroup | null => {
  const currentActive = findGroupById(proxyConfig.activeGroupId);
  if (currentActive) {
    return currentActive;
  }

  const fallback = proxyConfig.groups[0] ?? null;
  if (!fallback) {
    proxyConfig.activeGroupId = "";
    proxyConfig.targetBaseUrl = "";
    return null;
  }

  proxyConfig.activeGroupId = fallback.id;
  proxyConfig.targetBaseUrl = fallback.targetBaseUrl;
  return fallback;
};

const resolveGroupOrActive = (groupIdRaw: string | undefined): ProxyGroup | null => {
  if (groupIdRaw) {
    return findGroupById(groupIdRaw) ?? null;
  }
  return ensureActiveGroup();
};

const hasTargetConflict = (targetBaseUrl: string, ignoreGroupId?: string): boolean => {
  return proxyConfig.groups.some((group) => {
    if (ignoreGroupId && group.id === ignoreGroupId) {
      return false;
    }
    return group.targetBaseUrl === targetBaseUrl;
  });
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

const buildDownstreamHeaders = (
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

const serializeHistory = (): HistoryFilePayload => {
  const payload: HistoryFilePayload = {};
  for (const group of proxyConfig.groups) {
    payload[group.id] = ensureGroupHistory(group.id).slice(0, EFFECTIVE_HISTORY_PERSIST_LIMIT);
  }
  return payload;
};

const saveHistory = (): void => {
  enqueuePersist(async () => {
    await saveJsonFile(HISTORY_FILE, serializeHistory());
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

const isRecordBody = (value: unknown): value is ProxyPayloadBody => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const body = value as Partial<ProxyPayloadBody>;
  return (
    (typeof body.text === "string" || body.text === null) &&
    typeof body.size === "number" &&
    typeof body.truncated === "boolean" &&
    typeof body.isBinary === "boolean"
  );
};

const normalizeRecord = (value: unknown, groupId: string): ProxyTrafficRecord | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<ProxyTrafficRecord>;
  if (
    typeof item.id !== "string" ||
    typeof item.timestamp !== "string" ||
    typeof item.method !== "string" ||
    typeof item.path !== "string" ||
    !item.requestBody ||
    !isRecordBody(item.requestBody) ||
    typeof item.upstreamUrl !== "string" ||
    typeof item.durationMs !== "number"
  ) {
    return null;
  }

  return {
    id: item.id,
    groupId,
    timestamp: item.timestamp,
    method: item.method,
    path: item.path,
    query: item.query && typeof item.query === "object" ? item.query : {},
    requestHeaders: item.requestHeaders && typeof item.requestHeaders === "object" ? item.requestHeaders : {},
    requestBody: item.requestBody,
    upstreamUrl: item.upstreamUrl,
    responseStatus: typeof item.responseStatus === "number" ? item.responseStatus : null,
    responseHeaders: item.responseHeaders && typeof item.responseHeaders === "object" ? item.responseHeaders : {},
    responseBody: item.responseBody && isRecordBody(item.responseBody) ? item.responseBody : null,
    durationMs: item.durationMs,
    error: typeof item.error === "string" ? item.error : null,
  };
};

const hydrateGroupHistory = (
  fileHistory: Partial<Record<string, unknown>> | null,
  group: ProxyGroup,
): ProxyTrafficRecord[] => {
  const rawItems = fileHistory?.[group.id];
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const nextItems: ProxyTrafficRecord[] = [];
  const usedRecordIds = new Set<string>();
  for (const rawItem of rawItems) {
    const normalized = normalizeRecord(rawItem, group.id);
    if (normalized) {
      // Keep record ids unique in memory so UI keyed by id never collapses entries.
      let uniqueId = normalized.id;
      while (usedRecordIds.has(uniqueId)) {
        uniqueId = crypto.randomUUID();
      }
      usedRecordIds.add(uniqueId);
      nextItems.push(uniqueId === normalized.id ? normalized : { ...normalized, id: uniqueId });
    }
    if (nextItems.length >= HISTORY_LIMIT) {
      break;
    }
  }
  return nextItems;
};

/**
 * Ensure a traffic record id is unique inside one group history list.
 */
const ensureUniqueRecordId = (groupHistory: ProxyTrafficRecord[], preferredId: string): string => {
  if (!groupHistory.some((item) => item.id === preferredId)) {
    return preferredId;
  }

  let nextId = crypto.randomUUID();
  while (groupHistory.some((item) => item.id === nextId)) {
    nextId = crypto.randomUUID();
  }
  return nextId;
};

const addHistoryRecord = (groupId: string, record: ProxyTrafficRecord): void => {
  const groupHistory = ensureGroupHistory(groupId);
  const nextRecordId = ensureUniqueRecordId(groupHistory, record.id);
  const nextRecord = nextRecordId === record.id ? record : { ...record, id: nextRecordId };
  groupHistory.unshift(nextRecord);
  broadcastEvent({ type: "record", groupId, record: nextRecord });
  while (groupHistory.length > HISTORY_LIMIT) {
    const removed = groupHistory.pop();
    if (removed) {
      broadcastEvent({ type: "record_deleted", groupId, id: removed.id });
    }
  }
  saveHistory();
};

const filterRecords = (
  source: ProxyTrafficRecord[],
  methodRaw: string | undefined,
  pathRaw: string | undefined,
  statusRaw: string | undefined,
): ProxyTrafficRecord[] => {
  let filtered = source;
  if (methodRaw) {
    filtered = filtered.filter((item) => item.method === methodRaw);
  }
  if (pathRaw) {
    filtered = filtered.filter((item) => item.path.includes(pathRaw));
  }
  if (statusRaw) {
    const normalizedStatus = statusRaw.toLowerCase();
    if (normalizedStatus === "error") {
      filtered = filtered.filter((item) => item.error !== null);
    } else if (normalizedStatus === "2xx") {
      filtered = filtered.filter(
        (item) => item.responseStatus !== null && item.responseStatus >= 200 && item.responseStatus < 300,
      );
    } else if (normalizedStatus === "3xx") {
      filtered = filtered.filter(
        (item) => item.responseStatus !== null && item.responseStatus >= 300 && item.responseStatus < 400,
      );
    } else if (normalizedStatus === "4xx") {
      filtered = filtered.filter(
        (item) => item.responseStatus !== null && item.responseStatus >= 400 && item.responseStatus < 500,
      );
    } else if (normalizedStatus === "5xx") {
      filtered = filtered.filter(
        (item) => item.responseStatus !== null && item.responseStatus >= 500 && item.responseStatus < 600,
      );
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
  const fileHistory = await readJsonFile<Partial<Record<string, unknown>>>(HISTORY_FILE);
  const normalizedDefaultTarget =
    normalizeTargetBaseUrl(DEFAULT_TARGET_BASE_URL) ?? "http://localhost:8080";
  const hydratedGroups: ProxyGroup[] = [];
  const usedGroupIds = new Set<string>();
  const usedTargets = new Set<string>();

  if (Array.isArray(fileConfig?.groups)) {
    for (const group of fileConfig.groups) {
      if (!group || typeof group.id !== "string" || typeof group.targetBaseUrl !== "string") {
        continue;
      }

      const groupId = group.id.trim();
      if (!groupId || usedGroupIds.has(groupId)) {
        continue;
      }

      const normalizedTarget = normalizeTargetBaseUrl(group.targetBaseUrl);
      if (!normalizedTarget) {
        continue;
      }
      if (usedTargets.has(normalizedTarget)) {
        continue;
      }

      const normalizedName = normalizeGroupName(group.name ?? "", hydratedGroups.length + 1);
      hydratedGroups.push({
        id: groupId,
        name: normalizedName,
        targetBaseUrl: normalizedTarget,
      });
      usedGroupIds.add(groupId);
      usedTargets.add(normalizedTarget);
    }
  }

  if (hydratedGroups.length === 0) {
    const legacyTarget = fileConfig?.targetBaseUrl
      ? normalizeTargetBaseUrl(fileConfig.targetBaseUrl)
      : null;
    const fallbackTarget = legacyTarget ?? normalizedDefaultTarget;
    hydratedGroups.push(createGroup("默认分组", fallbackTarget));
  }

  proxyConfig.groups = hydratedGroups;
  const preferredGroupId = typeof fileConfig?.activeGroupId === "string" ? fileConfig.activeGroupId : "";
  const selectedGroup =
    (preferredGroupId ? hydratedGroups.find((group) => group.id === preferredGroupId) : null) ??
    hydratedGroups[0] ??
    null;

  proxyConfig.activeGroupId = selectedGroup?.id ?? "";
  syncConfigTargetBaseUrl();

  historyByGroup.clear();
  for (const group of hydratedGroups) {
    historyByGroup.set(group.id, hydrateGroupHistory(fileHistory, group));
  }

  saveConfig();
  saveHistory();
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
    console.log(`本地持久化最近条数：${EFFECTIVE_HISTORY_PERSIST_LIMIT}`);
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
    `${chalk.bold("Persist Recent")}: ${chalk.gray(String(EFFECTIVE_HISTORY_PERSIST_LIMIT))}`,
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
    historySize: listGroupHistorySize(),
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

  const hasGroupSwitch = typeof payload.activeGroupId === "string";
  const hasTargetUpdate = typeof payload.targetBaseUrl === "string";
  if (!hasGroupSwitch && !hasTargetUpdate) {
    return c.json({ message: "activeGroupId or targetBaseUrl is required." }, 400);
  }

  if (hasGroupSwitch) {
    const nextGroup = payload.activeGroupId
      ? findGroupById(payload.activeGroupId)
      : null;
    if (!nextGroup) {
      return c.json({ message: "activeGroupId not found." }, 400);
    }
    proxyConfig.activeGroupId = nextGroup.id;
  }

  const activeGroup = ensureActiveGroup();
  if (!activeGroup) {
    return c.json({ message: "No active group available." }, 500);
  }

  if (hasTargetUpdate) {
    const normalized = normalizeTargetBaseUrl(payload.targetBaseUrl ?? "");
    if (!normalized) {
      return c.json({ message: "targetBaseUrl must be a valid HTTP/HTTPS URL." }, 400);
    }
    if (normalized !== activeGroup.targetBaseUrl && hasTargetConflict(normalized, activeGroup.id)) {
      return c.json({ message: "targetBaseUrl already exists in another group." }, 409);
    }
    activeGroup.targetBaseUrl = normalized;
  }

  syncConfigTargetBaseUrl();
  saveConfig();
  broadcastEvent({ type: "config", config: proxyConfig });
  return c.json(proxyConfig);
});

app.post("/_proxira/api/groups", async (c) => {
  let payload: { name?: string; targetBaseUrl?: string; switchToNew?: boolean };
  try {
    payload = await c.req.json<{ name?: string; targetBaseUrl?: string; switchToNew?: boolean }>();
  } catch {
    return c.json({ message: "Invalid JSON payload." }, 400);
  }

  const groupName = payload.name?.trim() ?? "";
  if (!groupName) {
    return c.json({ message: "name is required." }, 400);
  }

  const nextTargetRaw = payload.targetBaseUrl?.trim() ?? "";
  if (!nextTargetRaw) {
    return c.json({ message: "targetBaseUrl is required." }, 400);
  }

  const normalizedTarget = normalizeTargetBaseUrl(nextTargetRaw);
  if (!normalizedTarget) {
    return c.json({ message: "targetBaseUrl must be a valid HTTP/HTTPS URL." }, 400);
  }

  if (hasTargetConflict(normalizedTarget)) {
    return c.json({ message: "targetBaseUrl already exists in another group." }, 409);
  }

  const nextGroup = createGroup(groupName, normalizedTarget);
  proxyConfig.groups.push(nextGroup);
  ensureGroupHistory(nextGroup.id);

  const switchToNew = payload.switchToNew ?? true;
  if (switchToNew) {
    proxyConfig.activeGroupId = nextGroup.id;
  }

  syncConfigTargetBaseUrl();
  saveConfig();
  saveHistory();
  broadcastEvent({ type: "config", config: proxyConfig });
  return c.json({ group: nextGroup, config: proxyConfig }, 201);
});

app.put("/_proxira/api/groups/:id", async (c) => {
  let payload: { name?: string; targetBaseUrl?: string; makeActive?: boolean };
  try {
    payload = await c.req.json<{ name?: string; targetBaseUrl?: string; makeActive?: boolean }>();
  } catch {
    return c.json({ message: "Invalid JSON payload." }, 400);
  }

  const groupId = c.req.param("id");
  const group = findGroupById(groupId);
  if (!group) {
    return c.json({ message: "group not found." }, 404);
  }

  const hasName = typeof payload.name === "string";
  const hasTarget = typeof payload.targetBaseUrl === "string";
  const hasActive = typeof payload.makeActive === "boolean";
  if (!hasName && !hasTarget && !hasActive) {
    return c.json({ message: "name, targetBaseUrl or makeActive is required." }, 400);
  }

  if (hasName) {
    const normalizedName = payload.name?.trim() ?? "";
    if (!normalizedName) {
      return c.json({ message: "name cannot be empty." }, 400);
    }
    group.name = normalizedName;
  }

  if (hasTarget) {
    const normalizedTarget = normalizeTargetBaseUrl(payload.targetBaseUrl ?? "");
    if (!normalizedTarget) {
      return c.json({ message: "targetBaseUrl must be a valid HTTP/HTTPS URL." }, 400);
    }
    if (normalizedTarget !== group.targetBaseUrl && hasTargetConflict(normalizedTarget, group.id)) {
      return c.json({ message: "targetBaseUrl already exists in another group." }, 409);
    }
    group.targetBaseUrl = normalizedTarget;
  }

  if (payload.makeActive) {
    proxyConfig.activeGroupId = group.id;
  }

  syncConfigTargetBaseUrl();
  saveConfig();
  broadcastEvent({ type: "config", config: proxyConfig });
  return c.json({ group, config: proxyConfig });
});

app.delete("/_proxira/api/groups/:id", (c) => {
  const groupId = c.req.param("id");
  const groupIndex = proxyConfig.groups.findIndex((group) => group.id === groupId);
  if (groupIndex === -1) {
    return c.json({ message: "group not found." }, 404);
  }

  const removedHistory = historyByGroup.get(groupId) ?? [];
  const clearedRecords = removedHistory.length;
  proxyConfig.groups.splice(groupIndex, 1);
  historyByGroup.delete(groupId);

  if (proxyConfig.groups.length === 0) {
    const fallbackTarget = normalizeTargetBaseUrl(DEFAULT_TARGET_BASE_URL) ?? "http://localhost:8080";
    const fallbackGroup = createGroup("默认分组", fallbackTarget);
    proxyConfig.groups = [fallbackGroup];
    historyByGroup.set(fallbackGroup.id, []);
  }

  if (proxyConfig.activeGroupId === groupId) {
    proxyConfig.activeGroupId = proxyConfig.groups[0]?.id ?? "";
  }

  syncConfigTargetBaseUrl();
  saveConfig();
  saveHistory();
  broadcastEvent({ type: "config", config: proxyConfig });

  return c.json({
    removed: true,
    id: groupId,
    clearedRecords,
    config: proxyConfig,
  });
});

app.post("/_proxira/api/reset", (c) => {
  const currentActiveGroup = ensureActiveGroup();
  const fallbackTarget =
    currentActiveGroup?.targetBaseUrl ??
    (normalizeTargetBaseUrl(DEFAULT_TARGET_BASE_URL) ?? "http://localhost:8080");

  const previousGroupCount = proxyConfig.groups.length;
  const previousRecordCount = listGroupHistorySize();

  const nextDefaultGroup = createGroup("默认分组", fallbackTarget);
  proxyConfig.groups = [nextDefaultGroup];
  proxyConfig.activeGroupId = nextDefaultGroup.id;
  syncConfigTargetBaseUrl();

  historyByGroup.clear();
  historyByGroup.set(nextDefaultGroup.id, []);

  saveConfig();
  saveHistory();
  broadcastEvent({ type: "config", config: proxyConfig });
  broadcastEvent({ type: "records_cleared", groupId: nextDefaultGroup.id });

  return c.json({
    ok: true,
    clearedGroups: previousGroupCount,
    clearedRecords: previousRecordCount,
    config: proxyConfig,
  });
});

app.get("/_proxira/api/records", (c) => {
  const limitRaw = Number(c.req.query("limit") ?? "50");
  const offsetRaw = Number(c.req.query("offset") ?? "0");
  const methodRaw = c.req.query("method")?.trim().toUpperCase();
  const pathRaw = c.req.query("path")?.trim();
  const statusRaw = c.req.query("status")?.trim();
  const groupIdRaw = c.req.query("groupId")?.trim();

  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, MAX_QUERY_LIMIT))
    : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

  const group = resolveGroupOrActive(groupIdRaw);
  if (!group) {
    return c.json({ message: "groupId not found." }, 404);
  }

  const filtered = filterRecords(ensureGroupHistory(group.id), methodRaw, pathRaw, statusRaw);

  const payload: ProxyRecordsResponse = {
    groupId: group.id,
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
  const groupIdRaw = c.req.query("groupId")?.trim();
  const group = resolveGroupOrActive(groupIdRaw);
  if (!group) {
    return c.json({ message: "groupId not found." }, 404);
  }
  const filtered = filterRecords(ensureGroupHistory(group.id), methodRaw, pathRaw, statusRaw);
  const safeGroupName = normalizeGroupName(group.name, 1);

  const payload: ProxyRecordsExportResponse = {
    exportedAt: new Date().toISOString(),
    groupId: group.id,
    groupName: safeGroupName,
    total: filtered.length,
    items: filtered,
  };
  const fileToken = payload.exportedAt.replace(/[:.]/g, "-");
  const groupToken =
    safeGroupName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") ||
    "group";
  const asciiGroupToken = toSafeAsciiToken(safeGroupName) || "group";
  const utf8FileName = `proxira-${groupToken}-records-${fileToken}.json`;
  const asciiFileName = `proxira-${asciiGroupToken}-records-${fileToken}.json`;

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeFilenameRFC5987(utf8FileName)}`,
    },
  });
});

app.get("/_proxira/api/records/:id", (c) => {
  const group = resolveGroupOrActive(c.req.query("groupId")?.trim());
  if (!group) {
    return c.json({ message: "groupId not found." }, 404);
  }
  const record = ensureGroupHistory(group.id).find((item) => item.id === c.req.param("id")) ?? null;
  const payload: ProxyRecordDetailResponse = { item: record };
  if (!record) {
    return c.json(payload, 404);
  }
  return c.json(payload);
});

app.delete("/_proxira/api/records/:id", (c) => {
  const group = resolveGroupOrActive(c.req.query("groupId")?.trim());
  if (!group) {
    return c.json({ message: "groupId not found." }, 404);
  }

  const groupHistory = ensureGroupHistory(group.id);
  const recordId = c.req.param("id");
  const targetIndex = groupHistory.findIndex((item) => item.id === recordId);
  if (targetIndex === -1) {
    return c.json({ removed: false, id: recordId }, 404);
  }

  groupHistory.splice(targetIndex, 1);
  saveHistory();
  broadcastEvent({ type: "record_deleted", groupId: group.id, id: recordId });
  return c.json({ removed: true, id: recordId });
});

app.delete("/_proxira/api/records", (c) => {
  const group = resolveGroupOrActive(c.req.query("groupId")?.trim());
  if (!group) {
    return c.json({ message: "groupId not found." }, 404);
  }

  const groupHistory = ensureGroupHistory(group.id);
  const removed = groupHistory.length;
  groupHistory.length = 0;
  saveHistory();
  broadcastEvent({ type: "records_cleared", groupId: group.id });
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
  const activeGroup = ensureActiveGroup();
  if (!activeGroup) {
    return c.json({ message: "No active group configured." }, 500);
  }

  const requestContentLengthRaw = c.req.header("content-length")?.trim();
  const requestContentLength = requestContentLengthRaw ? Number(requestContentLengthRaw) : Number.NaN;
  if (
    Number.isFinite(requestContentLength) &&
    requestContentLength > REQUEST_CONTENT_LENGTH_LIMIT
  ) {
    return c.json(
      {
        message: `Request body is too large. Limit is ${REQUEST_CONTENT_LENGTH_LIMIT} bytes.`,
      },
      413,
    );
  }

  const upstreamUrl = buildUpstreamUrl(activeGroup.targetBaseUrl, incomingUrl);
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
    const responseContentLengthRaw = upstreamResponse.headers.get("content-length");
    const responseContentLength = responseContentLengthRaw ? Number(responseContentLengthRaw) : Number.NaN;

    if (
      Number.isFinite(responseContentLength) &&
      responseContentLength > RESPONSE_BUFFER_LIMIT
    ) {
      const responseHeaders = collectHeaders(upstreamResponse.headers);
      const record: ProxyTrafficRecord = {
        id: crypto.randomUUID(),
        groupId: activeGroup.id,
        timestamp: new Date().toISOString(),
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
        },
        durationMs: Date.now() - startedAtMs,
        error: null,
      };

      addHistoryRecord(activeGroup.id, record);

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: buildDownstreamHeaders(upstreamResponse.headers, method),
      });
    }

    const responseBuffer = await upstreamResponse.arrayBuffer().catch(() => new ArrayBuffer(0));
    const responseBytes = new Uint8Array(responseBuffer);

    const responseBody = collectBody(
      responseBytes,
      upstreamResponse.headers.get("content-type"),
    );
    const responseHeaders = collectHeaders(upstreamResponse.headers);

    const record: ProxyTrafficRecord = {
      id: crypto.randomUUID(),
      groupId: activeGroup.id,
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

    addHistoryRecord(activeGroup.id, record);

    return new Response(responseBytes, {
      status: upstreamResponse.status,
      headers: buildDownstreamHeaders(upstreamResponse.headers, method, responseBytes.byteLength),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";

    const record: ProxyTrafficRecord = {
      id: crypto.randomUUID(),
      groupId: activeGroup.id,
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

    addHistoryRecord(activeGroup.id, record);

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
