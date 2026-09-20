import type { ProxyHeaders, ProxyTrafficRecord } from "@proxira/core";

export type StatusTone = "success" | "redirect" | "client" | "server" | "error" | "pending";

export const formatTime = (iso: string): string => new Date(iso).toLocaleTimeString();

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/**
 * 带毫秒的时刻。列表里只到秒就够，详情面板必须给到毫秒 ——
 * 同一个秒内连发的几条请求（一次页面加载、一个 SDK 的重试）只有毫秒能区分先后。
 * 返回 [时刻, 日期] 两段，方便调用方分别排版（大字号 + 小字号）。
 */
export const splitTimestamp = (
  iso: string,
): { time: string; date: string; weekday: string } | null => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return {
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
      date.getMilliseconds(),
      3,
    )}`,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    weekday: `星期${"日一二三四五六"[date.getDay()]}`,
  };
};

/**
 * 相对时间。给「这条请求是多久以前」一个不用心算的答案。
 * 未来时间（机器时钟偏差）一律说「刚刚」，不要显示负数。
 */
export const formatRelativeTime = (iso: string, now: number = Date.now()): string => {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diffMs = now - timestamp;
  if (diffMs < 10_000) return "刚刚";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1_000)} 秒前`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  if (diffMs < 2_592_000_000) return `${Math.floor(diffMs / 86_400_000)} 天前`;
  return "";
};

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
