import type { ProxyConfig, ProxyServerStatus } from "@proxira/core";

export type LoggerLike = Pick<Console, "log" | "error">;

export type FileSystemAdapter = {
  existsSync(path: string): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readTextFile(path: string): Promise<string>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeTextFile(path: string, data: string): Promise<void>;
};

export type RuntimeConfig = {
  internalRoutePrefix: string;
  defaultProxyPrefix: string;
  serverPort: number;
  bodyLimit: number;
  maxQueryLimit: number;
  sseHeartbeatMs: number;
  requestContentLengthLimit: number;
  responseBufferLimit: number;
  historyLimit: number;
  historyPersistLimit: number;
  effectiveHistoryPersistLimit: number;
  disableStartupBanner: boolean;
  dataDir: string;
  configFile: string;
  historyFile: string;
  defaultTargetBaseUrl: string;
  proxyPrefixEnabled: boolean;
  proxyPrefix: string;
  dashboardDistDir: string | null;
  cliMode: boolean;
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
