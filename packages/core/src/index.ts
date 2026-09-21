export type ProxyHeaderValue = string | string[];
export type ProxyHeaders = Record<string, ProxyHeaderValue>;

export type ProxyQueryValue = string | string[];
export type ProxyQueryParams = Record<string, ProxyQueryValue>;

export type BodyFormat =
  | "json"
  | "xml"
  | "form-urlencoded"
  | "html"
  | "yaml"
  | "text"
  | "csv"
  | "binary";

export interface ProxyPayloadBody {
  text: string | null;
  size: number;
  truncated: boolean;
  isBinary: boolean;
  format: BodyFormat;
}

export interface ProxyConfig {
  activeGroupId: string;
  groups: ProxyGroup[];
  targetBaseUrl: string;
  /** Reusable header groups. Targets reference them by id. */
  headerPresets: ProxyHeaderPreset[];
  /** Reusable mock groups. Targets reference them by id. */
  mockGroups: ProxyMockGroup[];
}

export interface ProxyGroup {
  id: string;
  name: string;
  targetBaseUrl: string;
  /** Upstream timeout override in ms; null means "use the global default". */
  upstreamTimeoutMs: number | null;
  /**
   * Legacy per-target header config, kept only so an old config.json still
   * loads. Hydration migrates it into a `ProxyHeaderPreset` and empties these
   * two lists, so at runtime they are normally empty.
   */
  customHeaders: ProxyHeaderEntry[];
  headerRules: ProxyHeaderRule[];
  /** Header groups applied to this target, in order — later ones win. */
  headerPresetIds: string[];
  /** Mock groups applied to this target, in order — first match wins. */
  mockGroupIds: string[];
}

// ---- Outbound request header rewriting ----------------------------------
// A target often needs its own auth scheme (or a stripped-down header set)
// without the app under test knowing. Fixed headers are appended first, then
// the rules run over the result — so a rule may target a fixed header too.

/** A header written onto every outbound request; same name = last one wins. */
export interface ProxyHeaderEntry {
  id: string;
  name: string;
  value: string;
}

export type ProxyHeaderRuleAction = "set" | "ignore";

export interface ProxyHeaderRule {
  id: string;
  enabled: boolean;
  /**
   * Case-insensitive prefix match against the outgoing header name
   * (e.g. `x-` matches `x-tenant-id` and `x-trace-id` at once).
   */
  namePrefix: string;
  /** set = overwrite the matched headers; ignore = drop them entirely. */
  action: ProxyHeaderRuleAction;
  /** Replacement value; only used when `action` is `set`. */
  value: string;
}

// ---- Reusable header groups ---------------------------------------------
// A preset bundles fixed headers + rewrite rules under one name, so several
// targets can share "our staging auth" instead of copy-pasting it. A target
// may apply several presets: they run in the listed order and a later preset
// overwrites what an earlier one wrote.

export interface ProxyHeaderPreset {
  id: string;
  name: string;
  /** Headers appended to every outbound request; same name = last one wins. */
  customHeaders: ProxyHeaderEntry[];
  /** Rewrite / drop rules, applied in order after `customHeaders`. */
  headerRules: ProxyHeaderRule[];
}

// ---- Mock server --------------------------------------------------------
// Mock answers live in their own groups, independent of the forwarding
// targets: a group holds many rules, and a target opts into the groups it
// wants. A hit returns immediately — the upstream is never contacted.

export interface ProxyMockRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Substring match against the incoming path (case-insensitive). */
  matchPath: string;
  /** Optional method filter; null matches every method. */
  matchMethod: string | null;
  /** Extra delay before responding. */
  delayMs: number;
  /** Response status code. */
  status: number;
  /** Response headers. */
  headers: ProxyHeaders;
  /** Response body (sent at once, or chunk by chunk when streaming). */
  body: string;
  /** Emit the body as an SSE stream, one chunk per line block. */
  stream: boolean;
  /** Gap between streamed chunks. */
  chunkIntervalMs: number;
}

export interface ProxyMockGroup {
  id: string;
  name: string;
  /** A disabled group is skipped entirely, whatever its rules say. */
  enabled: boolean;
  rules: ProxyMockRule[];
}

// ---- Intervention rules -------------------------------------------------
// Rules let the proxy answer or sabotage a request on purpose, so failure
// paths (timeouts, truncated streams, 5xx) can be reproduced without touching
// the app under test.

export type ProxyRuleActionType =
  | "mock"
  | "error"
  | "delay"
  | "break_stream"
  | "truncate";

export type ProxyRule = {
  id: string;
  groupId: string;
  name: string;
  enabled: boolean;
  /** Substring match against the incoming path (case-insensitive). */
  matchPath: string;
  /** Optional method filter; null matches every method. */
  matchMethod: string | null;
  /** Extra delay before anything else happens. */
  delayMs: number;
  /**
   * `mock` is legacy: hydration migrates those rules into `ProxyMockGroup`s
   * and they are no longer offered in the UI. The action stays supported so a
   * hand-written rules.json keeps behaving the way it always did.
   */
  action: ProxyRuleActionType;
  /** mock: response status code. */
  status: number;
  /** mock: response headers. */
  headers: ProxyHeaders;
  /** mock: response body (sent at once, or chunk by chunk when streaming). */
  body: string;
  /** mock: emit the body as an SSE stream, one chunk per line block. */
  stream: boolean;
  /** mock: gap between streamed chunks. */
  chunkIntervalMs: number;
  /** error: message returned to the client. */
  message: string;
  /** break_stream: stop the response after this many chunks. */
  afterChunks: number;
  /** truncate: keep only this many bytes of the response. */
  keepBytes: number;
};

export type ProxyRulesResponse = {
  groupId: string;
  items: ProxyRule[];
};

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
  /** Id of the intervention rule that produced this response, if any. */
  appliedRuleId: string | null;
  /** Where this entry came from: a proxied request or a manual replay. */
  source: ProxyRecordSource;
}

export type ProxyRecordSource = "proxy" | "replay";

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
  /** Absolute path to the on-disk data directory. Shown in Settings so the
   *  user can locate/inspect it, and opened by the "open folder" action. */
  dataDir: string;
}

export type ProxySseEvent =
  | { type: "snapshot"; config: ProxyConfig }
  | { type: "config"; config: ProxyConfig }
  | { type: "record"; groupId: string; record: ProxyTrafficRecord }
  | { type: "record_deleted"; groupId: string; id: string }
  | { type: "records_cleared"; groupId: string }
  | { type: "heartbeat"; at: string };
