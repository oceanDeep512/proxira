import type { ProxyHeaders } from "@proxira/core";

const SENSITIVE_KEY_PATTERN =
  /(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|passwd|session[-_]?id|bearer|openai[-_]?key|x-api-key|(^|[-_])token$)/i;

const MASK = "••••••••";

export const isSensitiveKey = (key: string): boolean =>
  SENSITIVE_KEY_PATTERN.test(key.trim());

const maskValue = (value: string): string => {
  if (value.length === 0) {
    return value;
  }
  // Keep a tiny hint so it is obvious the value exists but is hidden.
  return value.length <= 8 ? MASK.slice(0, 4) : `${MASK} (${value.length} chars)`;
};

export const redactHeaders = (headers: ProxyHeaders | null | undefined): ProxyHeaders => {
  if (!headers) {
    return {};
  }
  const result: ProxyHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = isSensitiveKey(name)
      ? Array.isArray(value)
        ? value.map((item) => maskValue(item))
        : maskValue(value)
      : value;
  }
  return result;
};

// Walk a JSON-ish structure and mask any value stored under a sensitive key.
export const redactJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      result[key] = isSensitiveKey(key) && typeof item === "string"
        ? maskValue(item)
        : redactJsonValue(item);
    }
    return result;
  }
  return value;
};

// Best-effort masking for text bodies that embed credentials (e.g. a JSON
// payload containing an api_key field, or a raw Authorization line).
export const redactText = (text: string): string => {
  let output = text.replace(
    /("(?:[^"\\]|\\.)*?(?:key|token|secret|password|passwd|authorization)":\s*)"((?:[^"\\]|\\.)*)"/gi,
    (_match, prefix: string, value: string) => `${prefix}"${maskValue(value)}"`,
  );
  output = output.replace(
    /(authorization:\s*)(bearer\s+)?\S+/gi,
    (_match, prefix: string, scheme?: string) => `${prefix}${scheme ?? ""}${MASK}`,
  );
  return output;
};
