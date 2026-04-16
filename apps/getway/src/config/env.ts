import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig } from "../app/types.js";
import type { FileSystemAdapter } from "../app/types.js";

const INTERNAL_ROUTE_PREFIX = "/_proxira";
const DEFAULT_PROXY_PREFIX = "/proxira";

const normalizePositiveInteger = (
  raw: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(raw ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
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
  const effectiveHistoryPersistLimit = Math.min(
    historyLimit,
    historyPersistLimit,
  );
  const requestContentLengthLimit = normalizePositiveInteger(
    env.PROXY_REQUEST_CONTENT_LENGTH_LIMIT,
    10 * 1024 * 1024,
  );
  const responseBufferLimit = normalizePositiveInteger(
    env.PROXY_RESPONSE_BUFFER_LIMIT,
    10 * 1024 * 1024,
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

  const dataDir = resolve(env.PROXY_DATA_DIR?.trim() || join(process.cwd(), ".proxira"));

  return {
    internalRoutePrefix: INTERNAL_ROUTE_PREFIX,
    defaultProxyPrefix: DEFAULT_PROXY_PREFIX,
    serverPort: Number(env.PORT ?? 3000),
    // Kept for backward compatibility. Body collection no longer truncates payload text.
    bodyLimit: normalizePositiveInteger(env.PROXY_BODY_LIMIT, 256 * 1024),
    maxQueryLimit: normalizePositiveInteger(env.PROXY_QUERY_LIMIT_MAX, 500),
    sseHeartbeatMs: normalizePositiveInteger(env.PROXY_SSE_HEARTBEAT_MS, 15_000),
    requestContentLengthLimit,
    // Kept for backward compatibility. Response capture no longer truncates by buffer size.
    responseBufferLimit,
    historyLimit,
    historyPersistLimit,
    effectiveHistoryPersistLimit,
    disableStartupBanner: env.PROXY_DISABLE_BANNER === "1",
    dataDir,
    configFile: join(dataDir, "config.json"),
    historyFile: join(dataDir, "history.json"),
    defaultTargetBaseUrl:
      env.PROXY_TARGET_URL?.trim() || "http://localhost:8080",
    proxyPrefixEnabled,
    proxyPrefix: proxyPrefix ?? "",
    dashboardDistDir: resolveDashboardDistDir(env, fs),
    cliMode: env.PROXY_CLI_MODE === "1",
    httpsEnabled: env.PROXY_HTTPS_ENABLED === "1",
    httpsKeyPath: env.PROXY_HTTPS_KEY_PATH?.trim() || null,
    httpsCertPath: env.PROXY_HTTPS_CERT_PATH?.trim() || null,
  };
};
