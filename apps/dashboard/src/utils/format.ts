import type { ProxyHeaders, ProxyTrafficRecord } from "@proxira/core";

export type StatusTone = "success" | "redirect" | "client" | "server" | "error" | "pending";

export const formatTime = (iso: string): string => new Date(iso).toLocaleTimeString();

export const formatDuration = (durationMs: number): string => `${durationMs} ms`;

export const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
};

export const toPrettyJson = (value: unknown): string => JSON.stringify(value, null, 2);

export const resolveStatusTone = (
  status: number | null,
  error: string | null,
): StatusTone => {
  if (error || status === null) {
    return "error";
  }
  if (status >= 200 && status < 300) {
    return "success";
  }
  if (status >= 300 && status < 400) {
    return "redirect";
  }
  if (status >= 400 && status < 500) {
    return "client";
  }
  if (status >= 500) {
    return "server";
  }
  return "pending";
};

export const shellEscape = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;

const appendHeaderArgs = (parts: string[], headers: ProxyHeaders): void => {
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push("-H", shellEscape(`${key}: ${item}`));
      }
      continue;
    }
    parts.push("-H", shellEscape(`${key}: ${value}`));
  }
};

export const buildCurlCommand = (record: ProxyTrafficRecord): string => {
  const commandParts = ["curl", "-X", record.method];
  appendHeaderArgs(commandParts, record.requestHeaders);
  if (
    record.method !== "GET" &&
    record.method !== "HEAD" &&
    record.requestBody.text &&
    record.requestBody.text.length > 0
  ) {
    commandParts.push("--data-raw", shellEscape(record.requestBody.text));
  }
  commandParts.push(shellEscape(record.upstreamUrl));
  return commandParts.join(" ");
};
