import { AlertTriangle, Copy } from "lucide-react";
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
        "font-mono text-[15px] font-semibold text-fg",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-danger",
        tone === "info" && "text-info",
      )}
    >
      {value}
    </span>
    {hint ? <span className="truncate text-[11px] text-fg-dim">{hint}</span> : null}
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
  const tone = statusToneMap[resolveStatusTone(record.responseStatus, record.error)];
  const requestSize = record.requestBody.size;
  const responseSize = record.responseBody?.size ?? 0;
  // 相对耗时条：以当前列表里最慢的一条为基准，给「这条有多慢」一个视觉锚点。
  const ratio = maxDurationMs > 0 ? Math.min(1, record.durationMs / maxDurationMs) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={methodTone(record.method)}>{record.method}</Pill>
        <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-fg">
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

      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
        <Stat
          label="状态"
          value={record.responseStatus ?? "ERR"}
          hint={record.error ? "请求未拿到响应" : undefined}
          tone={tone === "neutral" || tone === "info" ? undefined : tone}
        />
        <Stat label="耗时" value={formatDuration(record.durationMs)} />
        <Stat label="时间" value={formatTime(record.timestamp)} />
        <Stat label="响应大小" value={formatBytes(responseSize)} hint="响应正文字节数" />
        <Stat label="请求大小" value={formatBytes(requestSize)} hint="请求正文字节数" />
        <Stat
          label="Headers"
          value={`${Object.keys(record.requestHeaders).length} / ${Object.keys(record.responseHeaders).length}`}
          hint="请求 / 响应"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="px-title-eyebrow">相对耗时</span>
          <span className="font-mono text-[11px] text-fg-dim">
            基准 {formatDuration(maxDurationMs)}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300",
              tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-accent",
            )}
            style={{ width: `${Math.max(ratio * 100, 3)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {record.source === "replay" ? <Pill tone="accent">由重放产生</Pill> : null}
        {record.appliedRuleId ? <Pill tone="warning">命中拦截规则</Pill> : null}
        {record.requestBody.isBinary ? <Pill tone="neutral">请求正文为二进制</Pill> : null}
        {record.responseBody?.isBinary ? <Pill tone="neutral">响应正文为二进制</Pill> : null}
      </div>

      {record.error ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger/45 bg-danger/10 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-danger" />
            <span className="font-display text-[14px] font-semibold text-danger">请求失败</span>
          </div>
          <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-danger">
            {record.error}
          </pre>
        </div>
      ) : null}
    </div>
  );
};
