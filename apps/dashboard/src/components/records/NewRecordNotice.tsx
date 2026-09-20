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
 * 只在用户**没有停在最新一条**时出现（计数在 store 里累加），点击把详情切到最新那条请求。
 * 不去抢焦点、不自动跳转：正在读某条旧请求的时候被硬切走是最烦人的行为，
 * 给一个明确的入口让用户自己决定什么时候跟上去。
 */
export const NewRecordNotice = () => {
  const pendingNewCount = useProxiraStore((state) => state.pendingNewCount);
  // 新记录一律插到数组头部，所以 records[0] 就是「最新一条」。
  const latest = useProxiraStore((state) => state.records[0] ?? null);
  const selectRecord = useProxiraStore((state) => state.selectRecord);
  const acknowledgeNewRecords = useProxiraStore((state) => state.acknowledgeNewRecords);

  if (pendingNewCount === 0 || !latest) return null;

  const tone = toneText[resolveStatusTone(latest.responseStatus, latest.error)];

  const jumpToLatest = (): void => {
    selectRecord(latest.id);
    acknowledgeNewRecords();
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
            {pendingNewCount} 条新请求
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
          title="忽略（不跳转）"
          onClick={acknowledgeNewRecords}
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
