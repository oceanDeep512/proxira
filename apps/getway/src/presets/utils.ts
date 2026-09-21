import type { ProxyHeaderPreset } from "@proxira/core";
import { parseHeadersConfig } from "../headers/utils.js";

/**
 * Reusable header groups ("presets").
 *
 * Hydration rebuilds them from scratch so a hand-edited config.json can never
 * block startup: entries with an invalid or protected name are dropped rather
 * than surfaced as an error. The API layer is stricter — it turns the same
 * problems into a 400 so a bad paste never disappears silently.
 */

export const normalizePresetName = (nameRaw: string, fallbackIndex: number): string => {
  const normalized = nameRaw.trim();
  return normalized.length > 0 ? normalized : `请求头分组 ${fallbackIndex}`;
};

export const normalizeHeaderPresets = (
  raw: unknown,
  randomUUID: () => string,
): ProxyHeaderPreset[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const presets: ProxyHeaderPreset[] = [];
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

    const headers = parseHeadersConfig(candidate, randomUUID);
    usedIds.add(id);
    presets.push({
      id,
      name: normalizePresetName(
        typeof candidate.name === "string" ? candidate.name : "",
        presets.length + 1,
      ),
      customHeaders: headers.customHeaders,
      headerRules: headers.headerRules,
    });
  }

  return presets;
};

export const normalizeIdList = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const id = item.trim();
    if (!id || ids.includes(id)) {
      continue;
    }
    ids.push(id);
  }
  return ids;
};
