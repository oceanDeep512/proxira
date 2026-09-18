import type { ProxyConfig, ProxyServerStatus } from "@proxira/core";
import type { DataDirSource } from "../config/data-dir.js";

export type LoggerLike = Pick<Console, "log" | "error">;

export type FileSystemAdapter = {
  existsSync(path: string): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readTextFile(path: string): Promise<string>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeTextFile(path: string, data: string): Promise<void>;
  // Needed for atomic saves (write temp + rename) and for quarantining files
  // that cannot be parsed instead of silently overwriting them.
  rename(from: string, to: string): Promise<void>;
};

export type RuntimeConfig = {
  internalRoutePrefix: string;
  defaultProxyPrefix: string;
  host: string;
  serverPort: number;
  maxBodyCaptureBytes: number;
  /**
   * 流式响应（SSE / multipart）的捕获上限，0 = 不限制。
   * 与非流式正文分开：SSE 被截断等于整段调试信息丢失，默认全量保留。
   */
  streamMaxCaptureBytes: number;
  /** 流式响应采样时长上限（毫秒），0 = 不限制。 */
  streamMaxCaptureMs: number;
  upstreamTimeoutMs: number;
  persistDebounceMs: number;
  maxQueryLimit: number;
  sseHeartbeatMs: number;
  requestContentLengthLimit: number;
  historyLimit: number;
  historyPersistLimit: number;
  effectiveHistoryPersistLimit: number;
  historyPersistBodyLimitBytes: number;
  disableStartupBanner: boolean;
  dataDir: string;
  /** How the data directory was picked; shown at startup to make it obvious. */
  dataDirSource: DataDirSource;
  configFile: string;
  historyFile: string;
  rulesFile: string;
  defaultTargetBaseUrl: string;
  proxyPrefixEnabled: boolean;
  proxyPrefix: string;
  dashboardDistDir: string | null;
  cliMode: boolean;
  httpsEnabled: boolean;
  httpsKeyPath: string | null;
  httpsCertPath: string | null;
  /** Optional bearer token for the internal API/dashboard; null = open. */
  accessToken: string | null;
};

export type RuntimeDeps = {
  config: RuntimeConfig;
  fs: FileSystemAdapter;
  fetch: typeof fetch;
  now: () => number;
  randomUUID: () => string;
  logger: LoggerLike;
};

export type RecordsFilter = {
  method?: string | undefined;
  path?: string | undefined;
  status?: string | undefined;
};

export type RecordsQuery = RecordsFilter & {
  groupId?: string | undefined;
  limit: number;
  offset: number;
};

export type ExportRecordsQuery = RecordsFilter & {
  groupId?: string | undefined;
};

export type RuntimeStatusFactory = () => ProxyServerStatus;

export type JsonMessage = {
  message: string;
};

export type RuntimeSnapshot = {
  config: ProxyConfig;
  historySize: number;
  sseClients: number;
};
