import type { ProxyRule, ProxyRuleActionType } from "@proxira/core";

export const RULE_ACTION_TYPES: ProxyRuleActionType[] = [
  "mock",
  "error",
  "delay",
  "break_stream",
  "truncate",
];

const clampInt = (value: number, min: number, max: number, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
};

export const DEFAULT_RULE_STATUS = 200;
export const DEFAULT_CHUNK_INTERVAL_MS = 120;
export const DEFAULT_AFTER_CHUNKS = 2;
export const DEFAULT_KEEP_BYTES = 1_024;

export type RuleInput = {
  name?: string | null | undefined;
  enabled?: boolean | null | undefined;
  matchPath?: string | null | undefined;
  matchMethod?: string | null | undefined;
  delayMs?: number | null | undefined;
  action?: ProxyRuleActionType | null | undefined;
  status?: number | null | undefined;
  headers?: ProxyRule["headers"] | null | undefined;
  body?: string | null | undefined;
  stream?: boolean | null | undefined;
  chunkIntervalMs?: number | null | undefined;
  message?: string | null | undefined;
  afterChunks?: number | null | undefined;
  keepBytes?: number | null | undefined;
};

export const createRule = (
  groupId: string,
  input: RuleInput,
  randomUUID: () => string,
): ProxyRule => {
  const action: ProxyRuleActionType =
    input.action && RULE_ACTION_TYPES.includes(input.action) ? input.action : "mock";

  return {
    id: randomUUID(),
    groupId,
    name: input.name?.trim() || "未命名规则",
    enabled: input.enabled ?? true,
    matchPath: input.matchPath?.trim() || "/",
    matchMethod:
      typeof input.matchMethod === "string" && input.matchMethod.trim().length > 0
        ? input.matchMethod.trim().toUpperCase()
        : null,
    delayMs: clampInt(input.delayMs ?? 0, 0, 60_000, 0),
    action,
    status: clampInt(input.status ?? DEFAULT_RULE_STATUS, 100, 599, DEFAULT_RULE_STATUS),
    headers:
      input.headers && typeof input.headers === "object" && !Array.isArray(input.headers)
        ? input.headers
        : {},
    body: typeof input.body === "string" ? input.body : "",
    stream: input.stream ?? false,
    chunkIntervalMs: clampInt(
      input.chunkIntervalMs ?? DEFAULT_CHUNK_INTERVAL_MS,
      0,
      10_000,
      DEFAULT_CHUNK_INTERVAL_MS,
    ),
    message: input.message?.trim() || "Simulated upstream failure.",
    afterChunks: clampInt(input.afterChunks ?? DEFAULT_AFTER_CHUNKS, 0, 10_000, DEFAULT_AFTER_CHUNKS),
    keepBytes: clampInt(input.keepBytes ?? DEFAULT_KEEP_BYTES, 0, 100 * 1024 * 1024, DEFAULT_KEEP_BYTES),
  };
};

// A rule matches when the path contains the configured fragment and the
// method filter (if any) agrees. First enabled match wins.
export const ruleMatches = (
  rule: ProxyRule,
  method: string,
  path: string,
): boolean => {
  if (!rule.enabled) {
    return false;
  }
  if (rule.matchMethod && rule.matchMethod !== method.toUpperCase()) {
    return false;
  }
  const needle = rule.matchPath.trim();
  if (!needle || needle === "/") {
    return true;
  }
  return path.toLowerCase().includes(needle.toLowerCase());
};

export const findMatchingRule = (
  rules: ProxyRule[],
  method: string,
  path: string,
): ProxyRule | null => rules.find((rule) => ruleMatches(rule, method, path)) ?? null;
