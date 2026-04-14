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
): ProxyGroup => {
  return {
    id: randomUUID(),
    name: name.trim(),
    targetBaseUrl,
  };
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
