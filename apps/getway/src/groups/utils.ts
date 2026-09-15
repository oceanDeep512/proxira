import type { ProxyGroup } from "@proxira/core";

export const normalizeTargetBaseUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

export const createGroup = (
  name: string,
  targetBaseUrl: string,
  randomUUID: () => string,
  upstreamTimeoutMs: number | null = null,
): ProxyGroup => {
  return {
    id: randomUUID(),
    name: name.trim(),
    targetBaseUrl,
    upstreamTimeoutMs: normalizeTimeout(upstreamTimeoutMs),
  };
};

// A non-positive or non-finite timeout is meaningless: treat it as "no
// override" so the global default applies.
export const normalizeTimeout = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
};

export const normalizeGroupName = (
  nameRaw: string,
  fallbackIndex: number,
): string => {
  const normalized = nameRaw.trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return `分组 ${fallbackIndex}`;
};
