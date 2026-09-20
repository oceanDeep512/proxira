import type {
  ProxyHeaderEntry,
  ProxyHeaderRule,
  ProxyHeaderRuleAction,
} from "@proxira/core";
import { REQUEST_STRIP_HEADERS } from "../shared/http.js";

export const HEADER_RULE_ACTIONS: ProxyHeaderRuleAction[] = ["set", "ignore"];

/** Upper bounds per target: roomy enough for real work, small enough to parse. */
export const MAX_CUSTOM_HEADERS = 100;
export const MAX_HEADER_RULES = 100;

// RFC 7230 token. Rejecting spaces, colons and CR/LF is not cosmetic: a line
// break saved in a name or value would let a config inject extra headers into
// the outbound request, so this is a hard reject rather than a sanitize.
const TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Headers the proxy owns. `host` / `content-length` / `transfer-encoding` would
// produce a malformed request, and `accept-encoding` is dropped on purpose so
// upstream replies stay readable in the dashboard — none of them may be
// resurrected by a saved header config.
export const PROTECTED_HEADER_NAMES: ReadonlySet<string> = new Set<string>([
  ...REQUEST_STRIP_HEADERS,
  "accept-encoding",
]);

export const normalizeHeaderName = (name: string): string => name.trim().toLowerCase();

export const isValidHeaderName = (name: string): boolean => TOKEN_PATTERN.test(name.trim());

export const isProtectedHeaderName = (name: string): boolean =>
  PROTECTED_HEADER_NAMES.has(normalizeHeaderName(name));

const hasControlChars = (value: string): boolean => /[\r\n\0]/.test(value);

const readString = (value: unknown): string => (typeof value === "string" ? value : "");

const readId = (value: unknown, randomUUID: () => string): string => {
  const raw = readString(value).trim();
  return raw.length > 0 ? raw : randomUUID();
};

export type HeadersConfigInput = {
  customHeaders?: unknown;
  headerRules?: unknown;
};

export type HeadersParseResult = {
  customHeaders: ProxyHeaderEntry[];
  headerRules: ProxyHeaderRule[];
  /** One human-readable reason per entry that was skipped, empty when clean. */
  problems: string[];
};

const parseCustomHeaders = (
  raw: unknown,
  randomUUID: () => string,
  problems: string[],
): ProxyHeaderEntry[] => {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    problems.push("customHeaders must be an array.");
    return [];
  }
  if (raw.length > MAX_CUSTOM_HEADERS) {
    problems.push(`customHeaders accepts at most ${MAX_CUSTOM_HEADERS} entries.`);
    return [];
  }

  const entries: ProxyHeaderEntry[] = [];
  // Same name twice: the later entry wins, but keeps the original position so
  // the dashboard list does not reshuffle while typing.
  const indexByName = new Map<string, number>();

  for (let index = 0; index < raw.length; index += 1) {
    const label = `customHeaders[${index}]`;
    const item = (raw[index] ?? {}) as Record<string, unknown>;
    const name = readString(item.name).trim();
    const value = readString(item.value).trim();

    if (!name) {
      problems.push(`${label}: name is required.`);
      continue;
    }
    if (!isValidHeaderName(name)) {
      problems.push(`${label}: "${name}" is not a valid header name.`);
      continue;
    }
    if (isProtectedHeaderName(name)) {
      problems.push(`${label}: "${name}" is managed by the proxy and cannot be set.`);
      continue;
    }
    if (hasControlChars(value)) {
      problems.push(`${label}: value must not contain line breaks.`);
      continue;
    }

    const entry: ProxyHeaderEntry = { id: readId(item.id, randomUUID), name, value };
    const key = normalizeHeaderName(name);
    const existing = indexByName.get(key);
    if (existing === undefined) {
      indexByName.set(key, entries.length);
      entries.push(entry);
    } else {
      entries[existing] = entry;
    }
  }

  return entries;
};

const parseHeaderRules = (
  raw: unknown,
  randomUUID: () => string,
  problems: string[],
): ProxyHeaderRule[] => {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    problems.push("headerRules must be an array.");
    return [];
  }
  if (raw.length > MAX_HEADER_RULES) {
    problems.push(`headerRules accepts at most ${MAX_HEADER_RULES} entries.`);
    return [];
  }

  const rules: ProxyHeaderRule[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const label = `headerRules[${index}]`;
    const item = (raw[index] ?? {}) as Record<string, unknown>;
    const namePrefix = normalizeHeaderName(readString(item.namePrefix));
    const actionRaw = readString(item.action).trim();
    const action: ProxyHeaderRuleAction = actionRaw === "ignore" ? "ignore" : "set";
    const value = readString(item.value).trim();

    if (!namePrefix) {
      problems.push(`${label}: namePrefix is required.`);
      continue;
    }
    // A prefix must itself be a token: anything else could never match a real
    // header name, and an empty prefix would silently swallow every header.
    if (!isValidHeaderName(namePrefix)) {
      problems.push(`${label}: "${namePrefix}" is not a valid header name prefix.`);
      continue;
    }
    if (actionRaw !== "" && !HEADER_RULE_ACTIONS.includes(action as ProxyHeaderRuleAction)) {
      problems.push(`${label}: action must be "set" or "ignore".`);
      continue;
    }
    if (action === "set" && hasControlChars(value)) {
      problems.push(`${label}: value must not contain line breaks.`);
      continue;
    }

    rules.push({
      id: readId(item.id, randomUUID),
      enabled: item.enabled === undefined ? true : item.enabled === true,
      namePrefix,
      action,
      value: action === "set" ? value : "",
    });
  }

  return rules;
};

/**
 * Normalizes a persisted or API-supplied header config.
 *
 * Invalid entries are dropped and described in `problems` instead of throwing:
 * hydration must never fail on a hand-edited config.json, while the API layer
 * turns the same list into a 400 so a paste with a bad name cannot silently
 * disappear.
 */
export const parseHeadersConfig = (
  input: HeadersConfigInput,
  randomUUID: () => string,
): HeadersParseResult => {
  const problems: string[] = [];
  const customHeaders = parseCustomHeaders(input.customHeaders, randomUUID, problems);
  const headerRules = parseHeaderRules(input.headerRules, randomUUID, problems);
  return { customHeaders, headerRules, problems };
};

/**
 * Writes the fixed headers onto `headers`, then runs the rules in order.
 *
 * Order is the contract: fixed headers go on first, so a rule matching their
 * name prefix can rewrite or drop them as well.
 */
export const applyHeaderRules = (
  headers: Headers,
  customHeaders: readonly ProxyHeaderEntry[],
  headerRules: readonly ProxyHeaderRule[],
): void => {
  for (const entry of customHeaders) {
    headers.set(entry.name, entry.value);
  }

  for (const rule of headerRules) {
    if (!rule.enabled) {
      continue;
    }
    const prefix = normalizeHeaderName(rule.namePrefix);
    if (!prefix) {
      continue;
    }
    // Headers normalizes names to lower case, and `keys()` is a live iterator,
    // so snapshot it before mutating.
    for (const name of [...headers.keys()]) {
      if (!name.toLowerCase().startsWith(prefix)) {
        continue;
      }
      if (rule.action === "set") {
        headers.set(name, rule.value);
      } else {
        headers.delete(name);
      }
    }
  }

  stripProtectedHeaders(headers);
};

const stripProtectedHeaders = (headers: Headers): void => {
  for (const name of [...headers.keys()]) {
    if (isProtectedHeaderName(name)) {
      headers.delete(name);
    }
  }
};
