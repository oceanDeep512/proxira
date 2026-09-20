import { AlertTriangle, Copy, MousePointerClick } from "lucide-react";
import type { BodyFormat, ProxyTrafficRecord } from "@proxira/core";
import {
  formatBytes,
  formatDuration,
  formatRelativeTime,
  resolveStatusTone,
  splitTimestamp,
  type StatusTone,
} from "../../lib/format";
import { useCopy } from "../../hooks/useCopy";
import { useNow } from "../../hooks/useNow";
import { Pill, methodTone } from "../ui/Pill";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/cn";

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

const statusTextTone: Record<StatusTone, string> = {
  success: "text-success",
  redirect: "text-info",
  client: "text-warning",
  server: "text-danger",
  error: "text-danger",
  pending: "text-fg",
};

/** 正文格式用人话展示，别把 wire 上的小写枚举直接糊到界面上。 */
const FORMAT_TEXT: Record<BodyFormat, string> = {
  json: "JSON",
  xml: "XML",
  "form-urlencoded": "表单",
  html: "HTML",
  yaml: "YAML",
  text: "文本",
  csv: "CSV",
  binary: "二进制",
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-2">
    <h3 className="m-0 px-title-eyebrow">{title}</h3>
    {children}
  </section>
);

/**
 * 明细行：标签列定宽 + 值列左对齐。
 *
 * 刻意不做成卡片 —— 卡片的边框和留白会把一屏能看完的字段切成好几块，
 * 眼睛要在盒子之间来回跳。定宽标签列让所有值落在同一条竖直线上，
 * 才能「顺着往下扫」而不是「逐块找」。
 * 每行自己带下边框（而不是给容器用 divide-*）：dt / dd 是同一行的两个单元格，
 * 交给容器画线会在两列底部各画一条，内容高度不一致时看起来就是断的。
 */
const InfoList = ({ children }: { children: React.ReactNode }) => (
  <dl className="m-0 flex flex-col">{children}</dl>
);

const InfoRow = ({
  label,
  value,
  mono = true,
  title,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  title?: string;
}) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-line/70 py-1.5 last:border-b-0">
    <dt className="text-[12px] text-fg-dim">{label}</dt>
    <dd
      className={cn(
        "m-0 min-w-0 text-[13px] break-words text-fg",
        mono && "font-mono tabular-nums",
      )}
      title={title}
    >
      {value}
    </dd>
  </div>
);

export const OverviewTab = ({
  record,
  maxDurationMs,
}: {
  record: ProxyTrafficRecord;
  maxDurationMs: number;
}) => {
  const { copy } = useCopy();
  // 相对时间需要自己走针：没有新请求时 SSE 不会推事件，组件也就不重渲染。
  const now = useNow();

  const statusTone = resolveStatusTone(record.responseStatus, record.error);
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

  const stamp = splitTimestamp(record.timestamp);
  const relative = formatRelativeTime(record.timestamp, now);

  // 相对耗时条：以当前列表里最慢的一条为基准，给「这条有多慢」一个视觉锚点。
  const ratio = maxDurationMs > 0 ? Math.min(1, record.durationMs / maxDurationMs) : 0;
  const statusText = record.error
    ? "未拿到响应"
    : (STATUS_TEXT[record.responseStatus ?? 0] ?? "未知状态码");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pb-1">
      {/* 时间放在第一屏第一个位置，并且给到全部精度：同一秒内连发的请求只能靠毫秒排序。 */}
      <Section title="时间">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span
            className="font-mono text-[24px] leading-none font-semibold tracking-tight text-fg tabular-nums"
            title={record.timestamp}
          >
            {stamp?.time ?? "—"}
          </span>
          <span className="font-mono text-[13px] leading-none text-fg-soft tabular-nums">
            {stamp?.date ?? ""}
          </span>
          {stamp ? (
            <span className="text-[12px] leading-none text-fg-dim">{stamp.weekday}</span>
          ) : null}
          {relative ? (
            <span className="ml-auto text-[12px] leading-none text-fg-dim">{relative}</span>
          ) : null}
        </div>
      </Section>

      {/* 阅读顺序：先「什么时候发的」→ 再「发了什么」→ 再「回来了什么」→ 最后才是标识类信息。 */}
      <Section title="请求">
        <div className="flex items-start gap-2">
          <Pill tone={methodTone(record.method)} className="mt-0.5 shrink-0">
            {record.method}
          </Pill>
          <code className="min-w-0 flex-1 font-mono text-[13px] leading-relaxed break-all text-fg">
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
        <InfoList>
          <InfoRow
            label="Query"
            value={queryCount > 0 ? `${queryCount} 个参数` : "无"}
            title={queryCount > 0 ? Object.keys(record.query).join(", ") : undefined}
          />
          <InfoRow label="请求大小" value={formatBytes(requestSize)} title="正文字节数" />
          <InfoRow label="请求头" value={`${requestHeaders} 个`} />
          <InfoRow
            label="请求正文"
            value={FORMAT_TEXT[record.requestBody.format]}
            mono={false}
          />
        </InfoList>
      </Section>

      <Section title="响应">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span className="inline-flex items-baseline gap-1.5">
            <span
              className={cn(
                "font-mono text-[24px] leading-none font-semibold tracking-tight tabular-nums",
                statusTextTone[statusTone],
              )}
            >
              {record.responseStatus ?? "ERR"}
            </span>
            <span className="text-[12px] leading-none text-fg-soft">{statusText}</span>
          </span>
          <span aria-hidden className="h-4 w-px self-center bg-line" />
          <span className="inline-flex items-baseline gap-1.5">
            <span className="font-mono text-[24px] leading-none font-semibold tracking-tight text-fg tabular-nums">
              {record.durationMs}
            </span>
            <span className="text-[12px] leading-none text-fg-soft">ms</span>
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                statusTone === "server" || statusTone === "error"
                  ? "bg-danger"
                  : statusTone === "client"
                    ? "bg-warning"
                    : "bg-accent",
              )}
              style={{ width: `${Math.max(ratio * 100, 3)}%` }}
            />
          </div>
          <span className="text-[11px] text-fg-dim">
            耗时对比：本条 {formatDuration(record.durationMs)} · 当前列表最慢{" "}
            {formatDuration(maxDurationMs)}
          </span>
        </div>

        <InfoList>
          <InfoRow label="响应大小" value={formatBytes(responseSize)} title="正文字节数" />
          <InfoRow label="响应头" value={`${responseHeaders} 个`} />
          <InfoRow
            label="响应类型"
            value={contentType || "未声明"}
            mono={Boolean(contentType)}
            title={contentType || undefined}
          />
          <InfoRow
            label="响应正文"
            value={record.responseBody ? FORMAT_TEXT[record.responseBody.format] : "无"}
            mono={false}
          />
        </InfoList>
      </Section>

      <Section title="来源">
        <InfoList>
          <InfoRow
            label="产生方式"
            value={
              <Pill tone={record.source === "replay" ? "accent" : "neutral"}>
                {record.source === "replay" ? "由重放产生" : "代理转发"}
              </Pill>
            }
            mono={false}
          />
          <InfoRow
            label="命中规则"
            value={record.appliedRuleId ?? "无"}
            mono={Boolean(record.appliedRuleId)}
            title={record.appliedRuleId ?? undefined}
          />
          <InfoRow label="记录 ID" value={record.id} title={record.id} />
        </InfoList>
      </Section>

      {record.error ? (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 px-title-eyebrow">错误</h3>
          <div className="flex flex-col gap-2 border-l-2 border-danger/60 bg-danger/10 py-2 pl-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-danger" />
              <span className="font-display text-[14px] font-semibold text-danger">请求失败</span>
            </div>
            <pre className="m-0 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-danger">
              {record.error}
            </pre>
          </div>
        </section>
      ) : null}

      <p className="m-0 flex items-center gap-1.5 text-[11px] text-fg-dim">
        <MousePointerClick className="size-3 shrink-0" />
        上方切换到 Body / Headers / Query 可以看完整内容。
      </p>
    </div>
  );
};
