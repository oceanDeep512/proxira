import { useMemo } from "react";
import { Copy, Maximize2, Minimize2, MousePointerClick, Play } from "lucide-react";
import type { ProxyTrafficRecord } from "@proxira/core";
import { parseBody, redactBodyView, resolveContentType } from "../../lib/body";
import { buildCurlCommand } from "../../lib/format";
import { redactHeaders, redactText } from "../../lib/redact";
import { useCopy } from "../../hooks/useCopy";
import { useUiStore, type DetailTab } from "../../store/ui";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Pill, methodTone } from "../ui/Pill";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/cn";
import { BodyViewer } from "./BodyViewer";
import { HeadersView } from "./HeadersView";
import { OverviewTab } from "./OverviewTab";

// 状态 / 耗时这类摘要统一交给「概览」展示，标题行只保留请求类型 + 地址。
const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概览",
  "response-body": "响应 Body",
  "response-headers": "响应 Headers",
  "request-body": "请求 Body",
  "request-headers": "请求 Headers",
  query: "Query",
};

const TAB_ORDER: DetailTab[] = [
  "overview",
  "response-body",
  "response-headers",
  "request-body",
  "request-headers",
  "query",
];

export const DetailPanel = ({
  record,
  maxDurationMs,
  onReplay,
  replaying,
}: {
  record: ProxyTrafficRecord | null;
  maxDurationMs: number;
  onReplay: () => void;
  replaying: boolean;
}) => {
  const { copy } = useCopy();
  const activeTab = useUiStore((state) => state.activeTab);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const showSensitive = useUiStore((state) => state.showSensitive);
  const detailFocused = useUiStore((state) => state.detailFocused);
  const setDetailFocused = useUiStore((state) => state.setDetailFocused);

  const views = useMemo(() => {
    if (!record) return null;
    const rawRequest = parseBody(record.requestBody, record.requestHeaders);
    const rawResponse = parseBody(record.responseBody, record.responseHeaders);
    return {
      requestBody: showSensitive ? rawRequest : redactBodyView(rawRequest),
      responseBody: showSensitive ? rawResponse : redactBodyView(rawResponse),
      requestHeaders: showSensitive ? record.requestHeaders : redactHeaders(record.requestHeaders),
      responseHeaders: showSensitive
        ? record.responseHeaders
        : redactHeaders(record.responseHeaders),
      requestContentType: resolveContentType(record.requestHeaders),
      responseContentType: resolveContentType(record.responseHeaders),
      curl: buildCurlCommand({
        ...record,
        requestHeaders: showSensitive
          ? record.requestHeaders
          : redactHeaders(record.requestHeaders),
        ...(record.requestBody.text
          ? {
              requestBody: {
                ...record.requestBody,
                text: showSensitive ? record.requestBody.text : redactText(record.requestBody.text),
              },
            }
          : {}),
      }),
    };
  }, [record, showSensitive]);

  // 刻意**不**在切换记录时重置 activeTab：正在看「请求 Body」时切下一条，
  // 通常是想用同一个视角连续对比几条请求，跳回「概览」等于每次都要重点一遍。
  // tab 是全局状态（useUiStore），所以跨记录保留。

  if (!record || !views) {
    return (
      <section
        className={cn(
          "px-panel flex min-h-0 min-w-0 flex-1 basis-0 flex-col items-center justify-center overflow-hidden",
        )}
      >
        <EmptyState
          icon={<MousePointerClick />}
          title="还没有选中请求"
          hint={
            <>
              {/* 窄屏历史列表是弹窗，提示语要跟着变，否则用户找不到入口。 */}
              <span className="panel:hidden">
                点顶部「历史请求」按钮，在弹窗里挑一条即可查看详情。
              </span>
              <span className="hidden panel:inline">
                在左侧历史请求里点一条，这里会展示它的完整请求与响应。
              </span>
            </>
          }
        />
      </section>
    );
  }

  const countOf = (tab: DetailTab): number | null => {
    if (tab === "response-headers") return Object.keys(views.responseHeaders).length;
    if (tab === "request-headers") return Object.keys(views.requestHeaders).length;
    if (tab === "query") return Object.keys(record.query).length;
    return null;
  };

  return (
    <section
      className={cn(
        "px-panel flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden",
      )}
    >
      <header className="flex flex-col gap-2.5 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={methodTone(record.method)}>{record.method}</Pill>
          <h2
            className="min-w-0 flex-1 truncate font-mono text-[14px] font-medium"
            title={record.path}
          >
            {record.path}
          </h2>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={onReplay} disabled={replaying}>
              <Play className="size-3.5" />
              {replaying ? "重放中" : "重放"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copy("cURL", views.curl)}
            >
              <Copy className="size-3.5" />
              cURL
            </Button>
            {/* 窄屏专注模式：隐藏顶栏与转发地址区，详情整屏显示。
                只在堆叠布局（<960）出现，宽屏本来就是双栏，不需要。 */}
            <Tooltip label={detailFocused ? "退出全屏（Esc）" : "全屏查看当前请求"}>
              <Button
                size="sm"
                variant={detailFocused ? "secondary" : "ghost"}
                className="panel:hidden"
                aria-pressed={detailFocused}
                onClick={() => setDetailFocused(!detailFocused)}
              >
                {detailFocused ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
                {detailFocused ? "退出" : "展开"}
              </Button>
            </Tooltip>
          </div>
        </div>
        {/* 状态 / 耗时 / 时间这组已移到「概览」里集中展示，
            标题行只留请求类型 + 地址，切记录时这一行不再变高变矮。 */}
      </header>

      <nav
        role="tablist"
        aria-label="请求详情分区"
        className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2 py-1.5"
      >
        {TAB_ORDER.map((tab) => {
          const count = countOf(tab);
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
                "transition-colors duration-150 whitespace-nowrap",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                active
                  ? "bg-accent-soft text-accent-strong"
                  : "text-fg-soft hover:bg-surface-2 hover:text-fg",
              )}
            >
              {TAB_LABELS[tab]}
              {count !== null && count > 0 ? (
                <span className="font-mono text-[11px] text-fg-dim">{count}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* 内容区自己不再滚动：高度交给内部视图，由它自己滚。
          这层必须是 flex 列 + min-h-0，否则内层 flex-1 拿不到确定高度。 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        {activeTab === "overview" ? (
          <OverviewTab record={record} maxDurationMs={maxDurationMs} />
        ) : activeTab === "response-body" ? (
          <BodyViewer
            view={views.responseBody}
            contentType={views.responseContentType}
            sizeBytes={record.responseBody?.size ?? 0}
            copyLabel="响应 Body"
          />
        ) : activeTab === "response-headers" ? (
          <HeadersView headers={views.responseHeaders} />
        ) : activeTab === "request-body" ? (
          <BodyViewer
            view={views.requestBody}
            contentType={views.requestContentType}
            sizeBytes={record.requestBody.size}
            copyLabel="请求 Body"
          />
        ) : activeTab === "request-headers" ? (
          <HeadersView headers={views.requestHeaders} />
        ) : (
          <HeadersView headers={record.query} />
        )}
      </div>
    </section>
  );
};
