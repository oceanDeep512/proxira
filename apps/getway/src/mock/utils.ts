import type { ProxyHeaders, ProxyMockGroup, ProxyMockRule } from "@proxira/core";
import { DEFAULT_CHUNK_INTERVAL_MS, DEFAULT_RULE_STATUS, matchesRequest } from "../rules/utils.js";

/**
 * Mock answer rules.
 *
 * A mock rule is deliberately narrower than a legacy intervention rule: it can
 * only answer a request, never sabotage one. Failure injection stays in
 * `rules.json`; everything that "pretends to be the server" lives here.
 */

/** Upper bound per group: roomy for a real API surface, small enough to parse. */
export const MAX_MOCK_RULES = 100;

const clampInt = (value: number, min: number, max: number, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
};

export type MockRuleInput = {
  id?: string | null | undefined;
  name?: string | null | undefined;
  enabled?: boolean | null | undefined;
  matchPath?: string | null | undefined;
  matchMethod?: string | null | undefined;
  delayMs?: number | null | undefined;
  status?: number | null | undefined;
  headers?: ProxyHeaders | null | undefined;
  body?: string | null | undefined;
  stream?: boolean | null | undefined;
  chunkIntervalMs?: number | null | undefined;
};

export const createMockRule = (
  input: MockRuleInput,
  randomUUID: () => string,
): ProxyMockRule => ({
  id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : randomUUID(),
  name: input.name?.trim() || "未命名接口",
  enabled: input.enabled ?? true,
  matchPath: input.matchPath?.trim() || "/",
  matchMethod:
    typeof input.matchMethod === "string" && input.matchMethod.trim().length > 0
      ? input.matchMethod.trim().toUpperCase()
      : null,
  delayMs: clampInt(input.delayMs ?? 0, 0, 60_000, 0),
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
});

export const normalizeMockGroupName = (nameRaw: string, fallbackIndex: number): string => {
  const normalized = nameRaw.trim();
  return normalized.length > 0 ? normalized : `Mock 分组 ${fallbackIndex}`;
};

/**
 * Rebuilds persisted mock groups.
 *
 * Like every hydration path in this codebase this drops what it cannot trust
 * instead of throwing: a hand-edited config.json must never block startup.
 */
export const normalizeMockGroups = (
  raw: unknown,
  randomUUID: () => string,
): ProxyMockGroup[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const groups: ProxyMockGroup[] = [];
  const usedIds = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    if (!id || usedIds.has(id)) {
      continue;
    }
    // A rule id only has to be unique inside its own group.
    const rules = Array.isArray(candidate.rules)
      ? candidate.rules.map((rule) =>
          createMockRule(
            (rule ?? {}) as MockRuleInput,
            randomUUID,
          ),
        )
      : [];

    usedIds.add(id);
    groups.push({
      id,
      name: normalizeMockGroupName(
        typeof candidate.name === "string" ? candidate.name : "",
        groups.length + 1,
      ),
      enabled: candidate.enabled !== false,
      rules,
    });
  }

  return groups;
};

export const mockRuleMatches = (rule: ProxyMockRule, method: string, path: string): boolean =>
  matchesRequest(rule, method, path);

/** First enabled rule inside the group wins; the caller walks the groups in
 *  the order the target listed them. */
export const findMatchingMockRule = (
  rules: readonly ProxyMockRule[],
  method: string,
  path: string,
): ProxyMockRule | null => rules.find((rule) => mockRuleMatches(rule, method, path)) ?? null;
