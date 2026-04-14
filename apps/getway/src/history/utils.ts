import type {
  ProxyPayloadBody,
  ProxyTrafficRecord,
} from "@proxira/core";
import type { RecordsFilter } from "../app/types.js";

const isRecordBody = (value: unknown): value is ProxyPayloadBody => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<ProxyPayloadBody>;
  return (
    (typeof body.text === "string" || body.text === null) &&
    typeof body.size === "number" &&
    typeof body.truncated === "boolean" &&
    typeof body.isBinary === "boolean"
  );
};

export const normalizeRecord = (
  value: unknown,
  groupId: string,
): ProxyTrafficRecord | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<ProxyTrafficRecord>;
  if (
    typeof item.id !== "string" ||
    typeof item.timestamp !== "string" ||
    typeof item.method !== "string" ||
    typeof item.path !== "string" ||
    !item.requestBody ||
    !isRecordBody(item.requestBody) ||
    typeof item.upstreamUrl !== "string" ||
    typeof item.durationMs !== "number"
  ) {
    return null;
  }

  return {
    id: item.id,
    groupId,
    timestamp: item.timestamp,
    method: item.method,
    path: item.path,
    query: item.query && typeof item.query === "object" ? item.query : {},
    requestHeaders:
      item.requestHeaders && typeof item.requestHeaders === "object"
        ? item.requestHeaders
        : {},
    requestBody: item.requestBody,
    upstreamUrl: item.upstreamUrl,
    responseStatus:
      typeof item.responseStatus === "number" ? item.responseStatus : null,
    responseHeaders:
      item.responseHeaders && typeof item.responseHeaders === "object"
        ? item.responseHeaders
        : {},
    responseBody:
      item.responseBody && isRecordBody(item.responseBody)
        ? item.responseBody
        : null,
    durationMs: item.durationMs,
    error: typeof item.error === "string" ? item.error : null,
  };
};

export const ensureUniqueRecordId = (
  groupHistory: ProxyTrafficRecord[],
  preferredId: string,
  randomUUID: () => string,
): string => {
  if (!groupHistory.some((item) => item.id === preferredId)) {
    return preferredId;
  }

  let nextId = randomUUID();
  while (groupHistory.some((item) => item.id === nextId)) {
    nextId = randomUUID();
  }
  return nextId;
};

export const filterRecords = (
  source: ProxyTrafficRecord[],
  filter: RecordsFilter,
): ProxyTrafficRecord[] => {
  let filtered = source;
  const method = filter.method;
  const path = filter.path;
  const status = filter.status;

  if (method) {
    filtered = filtered.filter((item) => item.method === method);
  }
  if (path) {
    filtered = filtered.filter((item) => item.path.includes(path));
  }
  if (status) {
    const normalizedStatus = status.toLowerCase();
    if (normalizedStatus === "error") {
      filtered = filtered.filter((item) => item.error !== null);
    } else if (normalizedStatus === "2xx") {
      filtered = filtered.filter(
        (item) =>
          item.responseStatus !== null &&
          item.responseStatus >= 200 &&
          item.responseStatus < 300,
      );
    } else if (normalizedStatus === "3xx") {
      filtered = filtered.filter(
        (item) =>
          item.responseStatus !== null &&
          item.responseStatus >= 300 &&
          item.responseStatus < 400,
      );
    } else if (normalizedStatus === "4xx") {
      filtered = filtered.filter(
        (item) =>
          item.responseStatus !== null &&
          item.responseStatus >= 400 &&
          item.responseStatus < 500,
      );
    } else if (normalizedStatus === "5xx") {
      filtered = filtered.filter(
        (item) =>
          item.responseStatus !== null &&
          item.responseStatus >= 500 &&
          item.responseStatus < 600,
      );
    } else {
      const statusCode = Number(status);
      if (Number.isFinite(statusCode)) {
        filtered = filtered.filter((item) => item.responseStatus === statusCode);
      }
    }
  }

  return filtered;
};
