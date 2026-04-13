export type ProxyHeaderValue = string | string[];
export type ProxyHeaders = Record<string, ProxyHeaderValue>;

export type ProxyQueryValue = string | string[];
export type ProxyQueryParams = Record<string, ProxyQueryValue>;

export interface ProxyPayloadBody {
  text: string | null;
  size: number;
  truncated: boolean;
  isBinary: boolean;
}

export interface ProxyConfig {
  targetBaseUrl: string;
}

export interface ProxyTrafficRecord {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  query: ProxyQueryParams;
  requestHeaders: ProxyHeaders;
  requestBody: ProxyPayloadBody;
  upstreamUrl: string;
  responseStatus: number | null;
  responseHeaders: ProxyHeaders;
  responseBody: ProxyPayloadBody | null;
  durationMs: number;
  error: string | null;
}

export interface ProxyRecordsResponse {
  items: ProxyTrafficRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProxyRecordDetailResponse {
  item: ProxyTrafficRecord | null;
}

export interface ProxyServerStatus {
  startedAt: string;
  uptimeMs: number;
  config: ProxyConfig;
  historySize: number;
  sseClients: number;
}

export type ProxySseEvent =
  | { type: "snapshot"; config: ProxyConfig }
  | { type: "config"; config: ProxyConfig }
  | { type: "record"; record: ProxyTrafficRecord }
  | { type: "record_deleted"; id: string }
  | { type: "records_cleared" }
  | { type: "heartbeat"; at: string };
