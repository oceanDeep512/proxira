import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig } from "../app/types.js";
import type { FileSystemAdapter } from "../app/types.js";
import { resolveDataDir } from "./data-dir.js";

const INTERNAL_ROUTE_PREFIX = "/_proxira";
const DEFAULT_PROXY_PREFIX = "/proxira";

const DEFAULT_HOST = "127.0.0.1";

const normalizePositiveInteger = (
  raw: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(raw ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
};

const normalizePort = (raw: string | undefined): number => {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return 3000;
  }

  const parsed = Number(trimmed);
  // 0 is meaningful: let the OS assign a free port (useful in scripts / CI).
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(
      `PORT must be an integer between 0 and 65535 (0 = auto assign), received "${trimmed}".`,
    );
  }
  return parsed;
};

// 0 表示不限制（流式响应默认走这个：截断的 SSE 基本没有排查价值）。
// 负数与非法值一律回落到默认值。
const normalizeUnboundedInteger = (
  raw: string | undefined,
  fallback: number,
): number => {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const normalizeProxyPrefix = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withLeadingSlash = `/${trimmed}`.replace(/^\/+/, "/");
  const collapsed = withLeadingSlash.replace(/\/+/g, "/");
  const normalized = collapsed === "/" ? "/" : collapsed.replace(/\/$/, "");
  if (
    normalized === "/" ||
    normalized === INTERNAL_ROUTE_PREFIX ||
    normalized.startsWith(`${INTERNAL_ROUTE_PREFIX}/`)
  ) {
    return null;
  }

  return normalized;
};

const resolveDashboardDistDir = (
  env: NodeJS.ProcessEnv,
  fs: FileSystemAdapter,
): string | null => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const distRoot = resolve(moduleDir, "..");
  const fromEnv = env.DASHBOARD_DIST_DIR?.trim();
  const candidates = [
    fromEnv ? resolve(fromEnv) : null,
    resolve(distRoot, "../dashboard-dist"),
    resolve(distRoot, "../../dashboard/dist"),
    resolve(process.cwd(), "../dashboard/dist"),
    resolve(process.cwd(), "dashboard-dist"),
    resolve(process.cwd(), "apps/dashboard/dist"),
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    if (fs.existsSync(join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
};

export const loadRuntimeConfig = (
  env: NodeJS.ProcessEnv,
  fs: FileSystemAdapter,
): RuntimeConfig => {
  const historyLimit = normalizePositiveInteger(env.PROXY_HISTORY_LIMIT, 1_000);
  const historyPersistLimit = normalizePositiveInteger(
    env.PROXY_HISTORY_PERSIST_LIMIT,
    200,
  );
  // Bodies are re-clipped to this size when written to history.json: full
  // bodies (up to maxBodyCaptureBytes) stay in memory, but the persist file
  // stays bounded instead of growing to hundreds of megabytes.
  const historyPersistBodyLimitBytes = normalizePositiveInteger(
    env.PROXY_HISTORY_PERSIST_BODY_LIMIT,
    64 * 1024,
  );
  const effectiveHistoryPersistLimit = Math.min(
    historyLimit,
    historyPersistLimit,
  );
  const requestContentLengthLimit = normalizePositiveInteger(
    env.PROXY_REQUEST_CONTENT_LENGTH_LIMIT,
    10 * 1024 * 1024,
  );
  // Safety valve against unbounded buffering. Normal API payloads are captured
  // in full; bodies above this are stored as a prefix with `truncated: true`
  // and are still forwarded downstream without clipping.
  const maxBodyCaptureBytes = normalizePositiveInteger(
    env.PROXY_MAX_BODY_CAPTURE_BYTES,
    2 * 1024 * 1024,
  );
  // 流式响应（SSE / 流式 LLM 返回等）默认全量捕获：截断后既看不到完整内容，
  // 也无法判断是上游断了还是我们截的。只有显式设置下面的变量才会重新加上限。
  const streamMaxCaptureBytes = normalizeUnboundedInteger(
    env.PROXY_STREAM_MAX_CAPTURE_BYTES,
    0,
  );
  const streamMaxCaptureMs = normalizeUnboundedInteger(
    env.PROXY_STREAM_MAX_CAPTURE_MS,
    0,
  );
  const upstreamTimeoutMs = normalizePositiveInteger(
    env.PROXY_UPSTREAM_TIMEOUT_MS,
    30_000,
  );
  const persistDebounceMs = normalizePositiveInteger(
    env.PROXY_PERSIST_DEBOUNCE_MS,
    500,
  );
  const proxyPrefixEnabled = env.PROXY_PREFIX_ENABLED !== "0";
  const proxyPrefix = proxyPrefixEnabled
    ? normalizeProxyPrefix(env.PROXY_PREFIX?.trim() || DEFAULT_PROXY_PREFIX)
    : "";

  if (proxyPrefixEnabled && !proxyPrefix) {
    throw new Error(
      `PROXY_PREFIX must be a non-root path like ${DEFAULT_PROXY_PREFIX} and cannot conflict with ${INTERNAL_ROUTE_PREFIX}.`,
    );
  }

  // Single source of truth: the data directory never depends on the port or
  // the launch style, only on an explicit override or the per-user default.
  const { dataDir, source: dataDirSource } = resolveDataDir({ env });

  return {
    internalRoutePrefix: INTERNAL_ROUTE_PREFIX,
    defaultProxyPrefix: DEFAULT_PROXY_PREFIX,
    host: env.PROXY_HOST?.trim() || DEFAULT_HOST,
    serverPort: normalizePort(env.PORT),
    maxBodyCaptureBytes,
    streamMaxCaptureBytes,
    streamMaxCaptureMs,
    upstreamTimeoutMs,
    persistDebounceMs,
    maxQueryLimit: normalizePositiveInteger(env.PROXY_QUERY_LIMIT_MAX, 500),
    sseHeartbeatMs: normalizePositiveInteger(env.PROXY_SSE_HEARTBEAT_MS, 15_000),
    requestContentLengthLimit,
    historyLimit,
    historyPersistLimit,
    effectiveHistoryPersistLimit,
    historyPersistBodyLimitBytes,
    disableStartupBanner: env.PROXY_DISABLE_BANNER === "1",
    dataDir,
    dataDirSource,
    configFile: join(dataDir, "config.json"),
    historyFile: join(dataDir, "history.json"),
    rulesFile: join(dataDir, "rules.json"),
    defaultTargetBaseUrl:
      env.PROXY_TARGET_URL?.trim() || "http://localhost:8080",
    proxyPrefixEnabled,
    proxyPrefix: proxyPrefix ?? "",
    dashboardDistDir: resolveDashboardDistDir(env, fs),
    cliMode: env.PROXY_CLI_MODE === "1",
    httpsEnabled: env.PROXY_HTTPS_ENABLED === "1",
    httpsKeyPath: env.PROXY_HTTPS_KEY_PATH?.trim() || null,
    httpsCertPath: env.PROXY_HTTPS_CERT_PATH?.trim() || null,
    // Off by default: the server binds 127.0.0.1, so only expose it publicly
    // with a token when the user explicitly asks for it.
    accessToken: env.PROXY_ACCESS_TOKEN?.trim() || null,
  };
};
