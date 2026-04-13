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
  activeGroupId: string;
  groups: ProxyGroup[];
  targetBaseUrl: string;
}

export interface ProxyGroup {
  id: string;
  name: string;
  targetBaseUrl: string;
}

export interface ProxyTrafficRecord {
  id: string;
  groupId: string;
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
  groupId: string;
  items: ProxyTrafficRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProxyRecordsExportResponse {
  exportedAt: string;
  groupId: string;
  groupName: string;
  total: number;
  items: ProxyTrafficRecord[];
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
  | { type: "record"; groupId: string; record: ProxyTrafficRecord }
  | { type: "record_deleted"; groupId: string; id: string }
  | { type: "records_cleared"; groupId: string }
  | { type: "heartbeat"; at: string };
