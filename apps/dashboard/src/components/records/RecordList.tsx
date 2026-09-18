import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Download, RotateCcw, Search, X } from "lucide-react";
import type { ProxyTrafficRecord } from "@proxira/core";
import {
  METHOD_FILTER_OPTIONS,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  filterAndSortRecords,
} from "../../lib/filters";
import { formatDuration, formatTime, resolveStatusTone } from "../../lib/format";
import { selectCurrentTargetId, useProxiraStore } from "../../store/proxira";
import { useUiStore } from "../../store/ui";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { IconButton } from "../ui/IconButton";
import { Pill, methodTone } from "../ui/Pill";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/cn";

const ROW_HEIGHT = 62;

const statusToneMap = {
  success: "success",
  redirect: "info",
  client: "warning",
  server: "danger",
  error: "danger",
  pending: "neutral",
} as const;

const RecordRow = ({
  record,
  active,
  deleting,
  onSelect,
  onDelete,
}: {
  record: ProxyTrafficRecord;
  active: boolean;
  deleting: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) => {
  const tone = statusToneMap[resolveStatusTone(record.responseStatus, record.error)];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex h-[62px] cursor-pointer flex-col justify-center gap-1 px-3",
        "border-l-2 transition-colors duration-150",
        active
          ? "border-l-accent bg-accent-soft"
          : "border-l-transparent hover:bg-surface-2",
      )}
    >
      <div className="flex items-center gap-2">
        <Pill tone={methodTone(record.method)} className="shrink-0 px-1.5 py-0">
          {record.method}
        </Pill>
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg" title={record.path}>
          {record.path}
        </code>
        <Pill tone={tone} className="shrink-0 px-1.5 py-0">
          {record.responseStatus ?? "ERR"}
        </Pill>
        <IconButton
          label="删除该条记录"
          className={cn(
            "size-6 shrink-0 [&_svg]:size-3",
            "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
            // 触摸设备没有 hover，删除按钮必须常显，否则永远点不到。
            "pointer-coarse:opacity-100",
          )}
          tone="danger"
          disabled={deleting}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          {deleting ? "…" : <X />}
        </IconButton>
      </div>

      <div className="flex items-center gap-2 pl-0.5 text-[11px] text-fg-dim">
        <span className="font-mono">{formatDuration(record.durationMs)}</span>
        <span aria-hidden className="size-1 rounded-full bg-line-strong" />
        <span className="font-mono">{formatTime(record.timestamp)}</span>
        {record.source === "replay" ? <Pill tone="accent">重放</Pill> : null}
        {record.appliedRuleId ? <Pill tone="warning">规则</Pill> : null}
      </div>
    </div>
  );
};

export const RecordList = ({ isWide }: { isWide: boolean }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const records = useProxiraStore((state) => state.records);
  const recordsTotal = useProxiraStore((state) => state.recordsTotal);
  const loadingMore = useProxiraStore((state) => state.recordsLoadingMore);
  const selectedRecordId = useProxiraStore((state) => state.selectedRecordId);
  const selectRecord = useProxiraStore((state) => state.selectRecord);
  const removeRecord = useProxiraStore((state) => state.removeRecord);
  const deletingRecordId = useProxiraStore((state) => state.deletingRecordId);
  const loadMore = useProxiraStore((state) => state.loadMoreRecords);
  const clearRecords = useProxiraStore((state) => state.clearRecords);
  const clearing = useProxiraStore((state) => state.clearingRecords);
  const exportRecords = useProxiraStore((state) => state.exportRecords);
  const exporting = useProxiraStore((state) => state.exporting);
  const groupId = useProxiraStore(selectCurrentTargetId);

  const searchText = useUiStore((state) => state.searchText);
  const setSearchText = useUiStore((state) => state.setSearchText);
  const methodFilter = useUiStore((state) => state.methodFilter);
  const statusFilter = useUiStore((state) => state.statusFilter);
  const sortMode = useUiStore((state) => state.sortMode);
  const setMethodFilter = useUiStore((state) => state.setMethodFilter);
  const setStatusFilter = useUiStore((state) => state.setStatusFilter);
  const setSortMode = useUiStore((state) => state.setSortMode);
  const resetFilters = useUiStore((state) => state.resetFilters);
  const listPanelOpen = useUiStore((state) => state.listPanelOpen);
  const setListPanelOpen = useUiStore((state) => state.setListPanelOpen);

  const filtered = useMemo(
    () =>
      filterAndSortRecords(records, {
        methodFilter,
        statusFilter,
        sortMode,
        searchText,
      }),
    [records, methodFilter, statusFilter, sortMode, searchText],
  );

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const expanded = isWide || listPanelOpen;
  const filtersDirty =
    methodFilter !== "ALL" || statusFilter !== "ALL" || sortMode !== "time_desc" || !!searchText;

  const emptyLabel = !searchText.trim()
    ? records.length === 0
      ? "还没有请求记录"
      : "当前筛选条件下没有匹配记录"
    : `没有匹配「${searchText.trim()}」的记录`;

  return (
    <section
      className={cn(
        "px-card flex min-w-0 basis-full flex-col overflow-hidden",
        "panel:min-h-0 panel:flex-1 panel:basis-auto",
      )}
    >
      <div className="px-panel-head">
        <button
          type="button"
          onClick={() => setListPanelOpen(!listPanelOpen)}
          disabled={isWide}
          aria-expanded={expanded}
          className={cn(
            "flex min-w-0 items-center gap-1.5 rounded-sm text-left",
            "disabled:cursor-default",
          )}
        >
          {!isWide ? (
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-fg-dim transition-transform duration-150",
                expanded && "rotate-90",
              )}
            />
          ) : null}
          <h2 className="font-display text-[15px] font-semibold">历史请求</h2>
          <span className="font-mono text-[12px] text-fg-dim">{filtered.length}</span>
        </button>

        <div className={cn("flex items-center gap-1.5", !expanded && "hidden")}>
          <Button
            variant="ghost"
            size="sm"
            disabled={clearing || !groupId}
            onClick={() => void clearRecords()}
          >
            <RotateCcw className="size-3.5" />
            {clearing ? "清除中" : "清除"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={exporting || !groupId}
            onClick={() =>
              void exportRecords({ method: methodFilter, status: statusFilter })
            }
          >
            <Download className="size-3.5" />
            {exporting ? "导出中" : "导出"}
          </Button>
        </div>
      </div>

      <div
        className={cn("flex min-h-0 flex-1 flex-col", !expanded && "hidden")}
        // 折叠时用 hidden 而不是只改高度，避免面板仍占据滚动区域。
      >
        <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-fg-dim" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索 path…"
              aria-label="按路径搜索请求"
              className={cn(
                "min-h-8 w-full rounded-md border border-line bg-surface-2 pl-8 pr-2.5",
                "text-[13px] placeholder:text-fg-dim",
                "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft",
                "pointer-coarse:min-h-11",
              )}
            />
          </label>

          <div className="flex items-center gap-1.5">
            <Select
              compact
              className="flex-1"
              label="按 Method 过滤"
              value={methodFilter}
              onChange={setMethodFilter}
              options={METHOD_FILTER_OPTIONS}
            />
            <Select
              compact
              className="flex-1"
              label="按 Status 过滤"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTER_OPTIONS}
            />
            <Select
              compact
              className="flex-1"
              label="排序方式"
              value={sortMode}
              onChange={setSortMode}
              options={SORT_OPTIONS}
            />
            <Tooltip label="重置筛选">
              <IconButton
                label="重置筛选"
                className="size-7 [&_svg]:size-3.5"
                disabled={!filtersDirty}
                onClick={resetFilters}
              >
                <RotateCcw />
              </IconButton>
            </Tooltip>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<Search />} title={emptyLabel} className="flex-1" />
        ) : (
          <div
            ref={scrollRef}
            className="min-h-0 max-panel:max-h-[46dvh] flex-1 overflow-y-auto"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((item) => {
                const record = filtered[item.index];
                if (!record) return null;
                return (
                  <div
                    key={record.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: item.size,
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <RecordRow
                      record={record}
                      active={record.id === selectedRecordId}
                      deleting={deletingRecordId === record.id}
                      onSelect={() => {
                        selectRecord(record.id);
                        if (!isWide) setListPanelOpen(false);
                      }}
                      onDelete={() => void removeRecord(record.id)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {records.length < recordsTotal ? (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className={cn(
              "min-h-9 shrink-0 border-t border-line bg-surface-2 text-[12px] font-medium text-fg-soft",
              "transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-60",
            )}
          >
            {loadingMore ? "加载中…" : `加载更多（${records.length} / ${recordsTotal}）`}
          </button>
        ) : null}
      </div>
    </section>
  );
};
