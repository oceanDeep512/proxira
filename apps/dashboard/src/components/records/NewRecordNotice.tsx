import { ArrowDown, X } from "lucide-react";
import { formatDuration, resolveStatusTone } from "../../lib/format";
import { useProxiraStore } from "../../store/proxira";
import { cn } from "../../lib/cn";

const toneText = {
  success: "text-success",
  redirect: "text-info",
  client: "text-warning",
  server: "text-danger",
  error: "text-danger",
  pending: "text-fg-dim",
} as const;

/**
 * 「有 N 条新请求」浮动提示。
 *
 * 未读条数是**派生**出来的：列表按时间倒序，所以「当前选中的那条前面还有几条」
 * 就是有几条比你在看的更新。不用计数器维护，也就不存在「漏加一条」「某处忘了清零」
 * 这类账目错误，切换转发地址、清除记录、流式补全都不用特殊处理。
 *
 * 为什么详情不自动跳转：新请求的呈现方式就是「浮出这条提示，点了才跳」。
 * 一旦自动跟到最新，用户不主动点旧记录时就永远处于「已跟上」，
 * 提示永远不出现，点击跳转这个动作也失去意义。
 */
export const NewRecordNotice = () => {
  const newCount = useProxiraStore((state) => {
    if (state.selectedRecordId === null) return 0;
    const index = state.records.findIndex((record) => record.id === state.selectedRecordId);
    // -1 = 选中的那条已经被删掉或不在当前列表里；0 = 正停在最新。两种都不提示。
    return index > 0 ? index : 0;
  });
  // 新记录一律插到数组头部，所以 records[0] 就是「最新一条」。
  const latest = useProxiraStore((state) => state.records[0] ?? null);
  const dismissedNewestId = useProxiraStore((state) => state.dismissedNewestId);
  const selectRecord = useProxiraStore((state) => state.selectRecord);
  const dismissNewRecords = useProxiraStore((state) => state.dismissNewRecords);

  const dismissed = latest !== null && latest.id === dismissedNewestId;
  if (newCount === 0 || !latest || dismissed) return null;

  const tone = toneText[resolveStatusTone(latest.responseStatus, latest.error)];

  const jumpToLatest = (): void => {
    selectRecord(latest.id);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed bottom-5 left-1/2 z-[1900] -translate-x-1/2",
        "animate-[px-fade-up_200ms_cubic-bezier(0.22,1,0.36,1)]",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex max-w-[calc(100vw-24px)] items-center gap-1 rounded-full",
          "border border-accent/45 bg-surface p-1 pl-2.5 shadow-[var(--px-shadow-pop)]",
        )}
      >
        <button
          type="button"
          onClick={jumpToLatest}
          title={`查看最新请求 ${latest.method} ${latest.path}`}
          className={cn(
            "flex min-w-0 items-center gap-2.5 rounded-full px-1.5 py-1",
            "transition-colors duration-150 hover:bg-accent-soft",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          )}
        >
          <span className="relative flex size-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>

          <span className="shrink-0 text-[13px] font-medium whitespace-nowrap text-fg">
            {newCount} 条新请求
          </span>

          {/* 窄屏只留计数 + 入口：一条完整请求行塞不下，截断后的路径反而更难认。 */}
          <code
            className="hidden min-w-0 truncate font-mono text-[12px] text-fg-soft hub:inline"
            title={`${latest.method} ${latest.path}`}
          >
            {latest.method} {latest.path}
          </code>

          <span className="hidden shrink-0 items-center gap-1 font-mono text-[12px] hub:inline-flex">
            <span className={tone}>{latest.responseStatus ?? "…"}</span>
            <span className="text-fg-dim">·</span>
            <span className="text-fg-dim">{formatDuration(latest.durationMs)}</span>
          </span>

          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent-strong">
            查看最新
            <ArrowDown className="size-3" />
          </span>
        </button>

        <button
          type="button"
          aria-label="忽略新请求提示"
          title="忽略（不跳转，更新的请求会再提示）"
          onClick={dismissNewRecords}
          className={cn(
            "shrink-0 rounded-full p-1.5 text-fg-dim transition-colors hover:text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          )}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
};
