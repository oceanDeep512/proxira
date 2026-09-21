import { useEffect } from "react";
import { ArrowDown, X } from "lucide-react";
import { formatDuration, resolveStatusTone } from "../../lib/format";
import { useProxiraStore } from "../../store/proxira";
import { cn } from "../../lib/cn";

/** 提示条自己的寿命：到点自动收起，不等用户来点。 */
const NOTICE_TTL_MS = 8000;

const toneText = {
  success: "text-success",
  redirect: "text-info",
  client: "text-warning",
  server: "text-danger",
  error: "text-danger",
  pending: "text-fg-dim",
} as const;

/**
 * 「有 N 条新请求」提示：底部居中的**悬浮层**，不参与布局。
 *
 * 状态模型（这条很关键，早期版本用错过）：
 * - 可见性由 store 的 `noticeShownAt`（出现时间戳）决定，**不是**由「当前选中哪一条」
 *   派生出来的。按选中位置派生会出现三种怪象：看旧记录冒泡、看新记录没泡、
 *   切回旧记录泡又回来 —— 像气泡挂在了某条请求上。
 * - 未读条数才是派生的：列表按时间倒序，水位线 `newestSeenId` 之前的条数就是新增数。
 *   水位线只在「真正看到了」时推进（点「查看最新」/ 切到最新那条 / 点 X / 到点自动收起）。
 * - 提示有自己的寿命：出现后 {@link NOTICE_TTL_MS} 自动收起。持续有流量时**不**重置计时
 *   （见 store 里的 `?? Date.now()`），否则提示会被无限续命，等于一直挂着。
 *
 * 为什么详情不自动跳转：新请求的呈现方式就是「浮出这条提示，点了才跳」。
 * 一旦自动跟到最新，用户不主动点旧记录时就永远处于「已跟上」，
 * 提示永远不出现，点击跳转这个动作也失去意义。
 *
 * 位置：底部居中悬浮，而不是在文档流里占一行。
 * 占一行的版本会让顶栏到面板之间的内容在提示出现/消失时上下跳；
 * 悬浮层则完全不影响布局。放**底部**是刻意的：顶栏、转发地址行、详情头部
 * 全挤在上方，浮层压过去必盖住可交互控件；底部通常只有正文的空白区。
 * 外层容器 `pointer-events-none`、只有提示条本身可点，避免透明区域吃掉下方点击。
 */
export const NewRecordNotice = () => {
  const noticeShownAt = useProxiraStore((state) => state.noticeShownAt);
  const hideNewRecords = useProxiraStore((state) => state.hideNewRecords);
  // 新记录一律插到数组头部，所以 records[0] 就是「最新一条」。
  const latest = useProxiraStore((state) => state.records[0] ?? null);
  const selectRecord = useProxiraStore((state) => state.selectRecord);

  // 未读数：水位线之前的都是「比你看到的位置更新」的。水位线已被删掉（找不到）时算 0。
  const newCount = useProxiraStore((state) => {
    const index = state.records.findIndex((record) => record.id === state.newestSeenId);
    return index > 0 ? index : 0;
  });

  const active = noticeShownAt !== null && newCount > 0 && latest !== null;

  // 自己的寿命：出现后到点自动收起。
  // 依赖 noticeShownAt 而不是 active —— 期间再来新请求只换内容、不重新计时。
  useEffect(() => {
    if (noticeShownAt === null) return;
    const timer = window.setTimeout(() => hideNewRecords(), NOTICE_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [noticeShownAt, hideNewRecords]);

  const jumpToLatest = (): void => {
    if (latest) selectRecord(latest.id);
  };

  const shown = active ? latest : null;
  const tone = shown ? toneText[resolveStatusTone(shown.responseStatus, shown.error)] : "";

  return (
    // 容器常驻挂载：aria-live 区域要可靠播报，就不能随提示一起卸载。
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[900] flex justify-center px-3"
    >
      {shown ? (
        <div
          className={cn(
            "pointer-events-auto flex min-w-0 max-w-full items-center gap-1 rounded-full",
            "border border-accent/45 bg-surface p-1 pl-2.5 shadow-[var(--px-shadow-pop)]",
            "animate-[px-fade-up_220ms_cubic-bezier(0.22,1,0.36,1)]",
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
            title="忽略（不跳转；更新的请求会再提示）"
            onClick={hideNewRecords}
            className={cn(
              "shrink-0 rounded-full p-1.5 text-fg-dim transition-colors hover:text-fg",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            )}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
};
