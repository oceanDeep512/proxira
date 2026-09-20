import { useEffect, useState } from "react";
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
 * 「有 N 条新请求」提示，位于顶栏正下方、整行居中。
 *
 * 未读条数是**派生**出来的：列表按时间倒序，所以「当前选中的那条前面还有几条」
 * 就是有几条比你在看的更新。不用计数器维护，也就不存在「漏加一条」「某处忘了清零」
 * 这类账目错误，切换转发地址、清除记录、流式补全都不用特殊处理。
 *
 * 为什么详情不自动跳转：新请求的呈现方式就是「浮出这条提示，点了才跳」。
 * 一旦自动跟到最新，用户不主动点旧记录时就永远处于「已跟上」，
 * 提示永远不出现，点击跳转这个动作也失去意义。
 *
 * 位置：**独占一行**夹在顶栏和面板之间（不是在面板上浮一层）。
 * 试过浮层方案：宽屏会压住详情头部路径的尾巴，窄屏更糟 —— 会盖住左栏那行的
 * 「历史请求 N」按钮，而那正是打开列表看新请求的入口。压住可交互控件是硬伤，
 * 所以改成占位一行：任何宽度都不遮挡任何东西。
 *
 * 代价是出现/消失时内容会下移约 45px，用 `grid-rows 0fr→1fr` 过渡铺平，
 * 读起来像顶栏展开了一块，而不是「啪」地跳一下。
 * 外层容器**常驻挂载**（只切换行高），aria-live 区域才能可靠播报。
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
  const active = newCount > 0 && latest !== null && !dismissed;

  /**
   * 收起时**延迟卸载**内容。
   *
   * `0fr → 1fr` 的高度过渡靠行内内容撑开；一旦在收起的同时把内容摘掉，
   * `1fr` 立刻等于 0，行高会「瞬变」而不是过渡。所以先切 `0fr` 让它收，
   * 过渡结束再卸载。
   */
  const [mounted, setMounted] = useState(active);
  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  const jumpToLatest = (): void => {
    if (latest) selectRecord(latest.id);
  };

  // 收起动画期间内容要保持挂载，所以「挂载中」和「当前有提示」是两件事。
  const shown = mounted ? latest : null;
  const tone = shown ? toneText[resolveStatusTone(shown.responseStatus, shown.error)] : "";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "grid shrink-0 transition-[grid-template-rows] duration-200 ease-out",
        active ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
      // 只认自己那一行的过渡：子元素上的 transition-colors 也会冒泡上来。
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.propertyName !== "grid-template-rows") return;
        if (!active) setMounted(false);
      }}
    >
      {/* overflow-hidden 是 0fr→1fr 高度过渡的必要条件。 */}
      <div className="overflow-hidden">
        {shown ? (
          <div className="flex justify-center px-3 py-2">
            <div
              className={cn(
                "flex min-w-0 max-w-full items-center gap-1 rounded-full",
                "border border-accent/45 bg-surface p-1 pl-2.5 shadow-[var(--px-shadow-pop)]",
                "animate-[px-fade-down_200ms_cubic-bezier(0.22,1,0.36,1)]",
              )}
            >
              <button
                type="button"
                onClick={jumpToLatest}
                title={`查看最新请求 ${shown.method} ${shown.path}`}
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
                  title={`${shown.method} ${shown.path}`}
                >
                  {shown.method} {shown.path}
                </code>

                <span className="hidden shrink-0 items-center gap-1 font-mono text-[12px] hub:inline-flex">
                  <span className={tone}>{shown.responseStatus ?? "…"}</span>
                  <span className="text-fg-dim">·</span>
                  <span className="text-fg-dim">{formatDuration(shown.durationMs)}</span>
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
        ) : null}
      </div>
    </div>
  );
};
