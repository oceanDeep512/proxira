import { useMemo } from "react";
import { Copy, Play } from "lucide-react";
import type { ProxyTrafficRecord } from "@proxira/core";
import { parseBody, redactBodyView, resolveContentType } from "../../lib/body";
import { buildCurlCommand, formatDuration, formatTime, resolveStatusTone } from "../../lib/format";
import { redactHeaders, redactText } from "../../lib/redact";
import { useCopy } from "../../hooks/useCopy";
import { useUiStore, type DetailTab } from "../../store/ui";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Pill, methodTone } from "../ui/Pill";
import { cn } from "../../lib/cn";
import { BodyViewer } from "./BodyViewer";
import { HeadersView } from "./HeadersView";
import { OverviewTab } from "./OverviewTab";

const statusToneMap = {
  success: "success",
  redirect: "info",
  client: "warning",
  server: "danger",
  error: "danger",
  pending: "neutral",
} as const;

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

  if (!record || !views) {
    return (
      <section
        className={cn(
          "px-card flex min-w-0 basis-full flex-col items-center justify-center overflow-hidden",
          "panel:min-h-0 panel:flex-1 panel:basis-0",
        )}
      >
        <EmptyState
          title="还没有选中请求"
          hint="左侧历史请求里点一条，这里会展示解析后的响应与请求细节。"
        />
      </section>
    );
  }

  const tone = statusToneMap[resolveStatusTone(record.responseStatus, record.error)];
  const countOf = (tab: DetailTab): number | null => {
    if (tab === "response-headers") return Object.keys(views.responseHeaders).length;
    if (tab === "request-headers") return Object.keys(views.requestHeaders).length;
    if (tab === "query") return Object.keys(record.query).length;
    return null;
  };

  return (
    <section
      className={cn(
        "px-card flex min-w-0 basis-full flex-col overflow-hidden",
        "panel:min-h-0 panel:flex-1 panel:basis-0",
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
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={tone}>状态 {record.responseStatus ?? "ERR"}</Pill>
          <Pill tone="neutral">耗时 {formatDuration(record.durationMs)}</Pill>
          <Pill tone="neutral">{formatTime(record.timestamp)}</Pill>
          {record.source === "replay" ? <Pill tone="accent">重放</Pill> : null}
          {record.appliedRuleId ? <Pill tone="warning">规则</Pill> : null}
        </div>
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

      <div className="min-h-0 flex-1 overflow-auto p-3">
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
