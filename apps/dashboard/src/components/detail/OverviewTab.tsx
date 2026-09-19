import { AlertTriangle, Copy, MousePointerClick } from "lucide-react";
import type { ProxyTrafficRecord } from "@proxira/core";
import { formatBytes, formatDuration, formatTime, resolveStatusTone } from "../../lib/format";
import { useCopy } from "../../hooks/useCopy";
import { Pill, methodTone } from "../ui/Pill";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/cn";

const statusToneMap = {
  success: "success",
  redirect: "info",
  client: "warning",
  server: "danger",
  error: "danger",
  pending: "neutral",
} as const;

/** 常见状态码的简短文案，让「404」不只是个数字。 */
const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  206: "Partial Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

const formatDay = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="flex flex-col gap-1.5">
    <span className="px-title-eyebrow">{title}</span>
    {children}
  </section>
);

const Stat = ({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "success" | "warning" | "danger" | "info";
}) => (
  <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-surface-2 px-3 py-2">
    <span className="px-title-eyebrow">{label}</span>
    <span
      className={cn(
        "truncate font-mono text-[15px] font-semibold text-fg",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-danger",
        tone === "info" && "text-info",
      )}
      title={typeof value === "string" ? value : undefined}
    >
      {value}
    </span>
    {hint ? <span className="truncate text-[11px] text-fg-dim">{hint}</span> : null}
  </div>
);

const MetaChip = ({ label, value }: { label: string; value: string }) => (
  <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1">
    <span className="shrink-0 text-[11px] text-fg-dim">{label}</span>
    <span className="min-w-0 truncate font-mono text-[11px] text-fg-soft" title={value}>
      {value}
    </span>
  </span>
);

export const OverviewTab = ({
  record,
  maxDurationMs,
}: {
  record: ProxyTrafficRecord;
  maxDurationMs: number;
}) => {
  const { copy } = useCopy();
  const rawTone = statusToneMap[resolveStatusTone(record.responseStatus, record.error)];
  const tone = rawTone === "neutral" || rawTone === "info" ? undefined : rawTone;

  const requestHeaders = Object.keys(record.requestHeaders).length;
  const responseHeaders = Object.keys(record.responseHeaders).length;
  const queryCount = Object.keys(record.query).length;
  const requestSize = record.requestBody.size;
  const responseSize = record.responseBody?.size ?? 0;
  // header 值可能是 string[]（同名 header 多条），取第一条即可。
  const rawContentType = record.responseHeaders["content-type"];
  const contentType = (
    Array.isArray(rawContentType) ? (rawContentType[0] ?? "") : (rawContentType ?? "")
  ).trim();
  // 相对耗时条：以当前列表里最慢的一条为基准，给「这条有多慢」一个视觉锚点。
  const ratio = maxDurationMs > 0 ? Math.min(1, record.durationMs / maxDurationMs) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <Section title="请求">
        <div className="flex items-start gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5">
          <Pill tone={methodTone(record.method)} className="mt-px shrink-0">
            {record.method}
          </Pill>
          <code className="min-w-0 flex-1 break-all font-mono text-[13px] leading-relaxed text-fg">
            {record.upstreamUrl}
          </code>
          <Tooltip label="复制完整 URL">
            <IconButton
              label="复制完整 URL"
              className="size-7 shrink-0 [&_svg]:size-3.5"
              onClick={() => void copy("URL", record.upstreamUrl)}
            >
              <Copy />
            </IconButton>
          </Tooltip>
        </div>
      </Section>

      <Section title="指标">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-2">
          <Stat
            label="状态"
            value={record.responseStatus ?? "ERR"}
            hint={
              record.error
                ? "请求未拿到响应"
                : (STATUS_TEXT[record.responseStatus ?? 0] ?? "无状态码文案")
            }
            tone={tone}
          />
          <Stat label="耗时" value={formatDuration(record.durationMs)} />
          <Stat label="时间" value={formatTime(record.timestamp)} hint={formatDay(record.timestamp)} />
          <Stat label="响应大小" value={formatBytes(responseSize)} hint="正文字节数" />
          <Stat label="请求大小" value={formatBytes(requestSize)} hint="正文字节数" />
          <Stat label="Query" value={queryCount} hint="参数个数" />
          <Stat label="Headers" value={`${requestHeaders} / ${responseHeaders}`} hint="请求 / 响应" />
        </div>
      </Section>

      <Section title="相对耗时">
        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-fg-dim">
              本条 {formatDuration(record.durationMs)}
            </span>
            <span className="font-mono text-[11px] text-fg-dim">
              基准 {formatDuration(maxDurationMs)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                rawTone === "danger" ? "bg-danger" : rawTone === "warning" ? "bg-warning" : "bg-accent",
              )}
              style={{ width: `${Math.max(ratio * 100, 3)}%` }}
            />
          </div>
        </div>
      </Section>

      <Section title="元信息">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={record.source === "replay" ? "accent" : "neutral"}>
              {record.source === "replay" ? "由重放产生" : "代理转发"}
            </Pill>
            {record.appliedRuleId ? <Pill tone="warning">命中拦截规则</Pill> : null}
            {record.requestBody.isBinary ? <Pill tone="neutral">请求正文为二进制</Pill> : null}
            {record.responseBody?.isBinary ? <Pill tone="neutral">响应正文为二进制</Pill> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {contentType ? <MetaChip label="响应类型" value={contentType} /> : null}
            <MetaChip label="记录 ID" value={record.id} />
          </div>
        </div>
      </Section>

      {record.error ? (
        <Section title="错误">
          <div className="flex flex-col gap-2 rounded-md border border-danger/45 bg-danger/10 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-danger" />
              <span className="font-display text-[14px] font-semibold text-danger">请求失败</span>
            </div>
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-danger">
              {record.error}
            </pre>
          </div>
        </Section>
      ) : null}

      <p className="m-0 flex items-center gap-1.5 text-[11px] text-fg-dim">
        <MousePointerClick className="size-3 shrink-0" />
        上方切换到 Body / Headers / Query 可以看完整内容。
      </p>
    </div>
  );
};
