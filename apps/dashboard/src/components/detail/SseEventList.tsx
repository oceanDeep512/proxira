import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { SseEventView } from "../../lib/body";
import { JsonTree } from "./JsonTree";
import { ToolbarButton, ToolbarGroup, ViewerBody, ViewerFrame, ViewerToolbar } from "./ViewerShell";
import { cn } from "../../lib/cn";

/** SSE：逐帧折叠 + 全局折叠/展开，JSON 帧直接走树视图。 */
export const SseEventList = ({
  events,
  truncated,
  query = "",
  toolbarExtra,
}: {
  events: SseEventView[];
  truncated?: boolean;
  query?: string;
  toolbarExtra?: ReactNode;
}) => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());

  const allCollapsed = events.length > 0 && collapsed.size === events.length;

  const toggle = (index: number) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  return (
    <ViewerFrame className="min-h-0 flex-1">
      <ViewerToolbar>
        <span className="min-w-[6rem] truncate font-mono text-[11px] text-fg-dim">
          {events.length} 个事件
        </span>
        <ToolbarButton
          label={allCollapsed ? "全部展开" : "全部折叠"}
          onClick={() =>
            setCollapsed(allCollapsed ? new Set() : new Set(events.map((_, index) => index)))
          }
          disabled={events.length === 0}
        />
        <ToolbarGroup>{toolbarExtra}</ToolbarGroup>
      </ViewerToolbar>

      <ViewerBody fill className="px-2">
        {truncated ? (
          <p className="m-0 px-0.5 py-1 text-[11px] text-fg-dim">
            流较长，仅采样了前部分事件，完整内容请用上游日志核对。
          </p>
        ) : null}

        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {events.map((event, index) => {
          const isCollapsed = collapsed.has(index);
          return (
            <li
              key={`sse-${index}`}
              className="overflow-hidden rounded-md border border-line bg-surface-2"
            >
              <button
                type="button"
                onClick={() => toggle(index)}
                aria-expanded={!isCollapsed}
                className="flex min-h-9 w-full items-center gap-2 px-2.5 py-1.5 text-left"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-fg-dim transition-transform duration-150",
                    !isCollapsed && "rotate-90",
                  )}
                />
                <span className="font-mono text-[11px] text-fg-dim">#{index + 1}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px font-mono text-[11px] font-semibold",
                    event.event === "message"
                      ? "bg-surface-3 text-fg-soft"
                      : "bg-accent-soft text-accent-strong",
                  )}
                >
                  {event.event}
                </span>
                {event.id ? (
                  <span className="truncate font-mono text-[11px] text-fg-dim">
                    id: {event.id}
                  </span>
                ) : null}
              </button>

              {!isCollapsed ? (
                <div className="border-t border-line px-2.5 py-2">
                  {event.jsonData !== null ? (
                    <JsonTree data={event.jsonData} query={query} />
                  ) : (
                    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-fg">
                      {event.data}
                    </pre>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      </ViewerBody>
    </ViewerFrame>
  );
};
