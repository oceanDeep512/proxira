import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Braces, Copy, Download, FileQuestion, Search, UnfoldVertical } from "lucide-react";
import type { BodyView } from "../../lib/body";
import {
  bodyModeLabel,
  bodyUsesCsvTable,
  bodyUsesJsonTree,
  bodyUsesRichPreview,
  bodyUsesSseEvents,
  bodyViewToCopyText,
} from "../../lib/body";
import { formatBytes, toPrettyJson } from "../../lib/format";
import { useCopy } from "../../hooks/useCopy";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Pill } from "../ui/Pill";
import { Segmented } from "../ui/Segmented";
import { ToolbarButton, ViewerBody, ViewerFrame, ViewerToolbar } from "./ViewerShell";
import { CodeViewer, languageForMode } from "./CodeViewer";
import { CsvTable } from "./CsvTable";
import { JsonTree } from "./JsonTree";
import { SseEventList } from "./SseEventList";
import { cn } from "../../lib/cn";

type BodyMode = "tree" | "sse" | "table" | "preview" | "raw";

// 单次渲染的兜底：再大的正文也先折叠，避免点开一条就把标签页卡住。
const LARGE_BYTES = 96 * 1024;

export const BodyViewer = ({
  view,
  contentType,
  sizeBytes,
  copyLabel,
}: {
  view: BodyView;
  contentType: string;
  sizeBytes: number;
  copyLabel: string;
}) => {
  const { copy } = useCopy();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  // mode / query 都属于「这条记录」的视图状态：换记录必须重置，
  // 否则上一条选的「原始」会串到下一条的 JSON 上。
  const [mode, setMode] = useState<BodyMode | null>(null);
  const [minified, setMinified] = useState(false);
  const [viewKey, setViewKey] = useState(view);
  if (viewKey !== view) {
    setViewKey(view);
    setMode(null);
    setQuery("");
    setExpanded(false);
    setMinified(false);
  }

  const options = useMemo(() => {
    const list: Array<{ value: BodyMode; label: string }> = [];
    if (bodyUsesJsonTree(view)) list.push({ value: "tree", label: "树形" });
    if (bodyUsesSseEvents(view)) list.push({ value: "sse", label: "事件流" });
    if (bodyUsesCsvTable(view)) list.push({ value: "table", label: "表格" });
    if (bodyUsesRichPreview(view)) list.push({ value: "preview", label: "预览" });
    list.push({ value: "raw", label: "原始" });
    return list;
  }, [view]);

  // mode 为 null 表示「这条记录的默认视图」：JSON→树形、HTML/MD→预览、CSV→表格。
  const activeMode =
    mode && options.some((option) => option.value === mode)
      ? mode
      : (options[0]?.value ?? "raw");

  // JSON 解析成功后 parseBody 会把 text 留空（数据只存在 jsonData 里），
  // 所以「原始」视图必须回落到序列化的 JSON，否则会渲染出一个空框。
  const jsonFallback = !view.text && view.jsonData !== null && view.jsonData !== undefined;
  const rawText = jsonFallback
    ? minified
      ? JSON.stringify(view.jsonData)
      : toPrettyJson(view.jsonData)
    : view.text;

  const tooLarge = sizeBytes > LARGE_BYTES && !expanded;

  // 和浏览器控制台一致：⌘F / Ctrl+F 直接聚焦正文搜索框，Esc 清空退出。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const input = searchRef.current;
      if (!input) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        input.focus();
        input.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const lineCount = useMemo(() => rawText.split("\n").length, [rawText]);

  const download = (): void => {
    const blob = new Blob([bodyViewToCopyText(view)], {
      type: `${contentType || "text/plain"}; charset=utf-8`,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `proxira-${copyLabel.replace(/\s+/g, "-")}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // 复制 / 下载统一挂在内容面板的顶部菜单里：这样切「树形 / 原始 / 表格 / 预览」
  // 时标题行的按钮数量永远一致，不会左右跳动。
  const actions: ReactNode = (
    <>
      <ToolbarButton
        label="复制"
        icon={<Copy className="size-3" />}
        onClick={() => void copy(copyLabel, bodyViewToCopyText(view))}
      />
      <ToolbarButton label="下载" icon={<Download className="size-3" />} onClick={download} />
    </>
  );

  // 单独提出来，避免深层三元嵌套里数错括号（可读性也比内联好）。
  const rawNode = rawText ? (
    <CodeViewer
      code={rawText}
      language={languageForMode(view.mode)}
      query={query}
      maxHeight={560}
      toolbarExtra={
        <>
          {jsonFallback ? (
            <ToolbarButton
              label={minified ? "格式化" : "压缩"}
              icon={<Braces className="size-3" />}
              onClick={() => setMinified((value) => !value)}
            />
          ) : null}
          {actions}
        </>
      }
    />
  ) : (
    <EmptyState
      icon={<FileQuestion />}
      title="没有正文内容"
      hint={
        copyLabel === "请求 Body"
          ? "该请求没有请求体（GET / HEAD 请求通常没有）。"
          : (view.note && view.mode !== "empty"
            ? view.note
            : "该方向没有记录到正文（可能是空响应或流式响应未捕获）。")
      }
    />
  );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Pill tone="accent">{bodyModeLabel(view)}</Pill>
        {contentType ? (
          <Pill tone="neutral" title={contentType} className="max-w-[220px]">
            {contentType}
          </Pill>
        ) : null}
        <span className="font-mono text-[11px] text-fg-dim">{formatBytes(sizeBytes)}</span>
        {rawText ? (
          <span className="font-mono text-[11px] text-fg-dim">{lineCount} 行</span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2 size-3 text-fg-dim" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setQuery("");
                  event.currentTarget.blur();
                }
              }}
              placeholder="搜索内容…"
              aria-label={`在${copyLabel}中搜索`}
              className={cn(
                "h-7 w-[130px] rounded-full border border-line bg-surface-2 pl-6 pr-2",
                "text-[12px] placeholder:text-fg-dim",
                "focus:w-[180px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft",
                "transition-[width,border-color] duration-150",
              )}
            />
          </label>

          {/* 复制/下载已移进内容面板顶部菜单，这里只留搜索与视图切换，切视图不再跳布局 */}
          {options.length > 1 ? (
            <Segmented
              ariaLabel={`${copyLabel} 视图`}
              value={activeMode}
              onChange={setMode}
              options={options}
            />
          ) : null}
        </div>
      </div>

      {view.truncated ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-warning/50 bg-warning/10 px-2.5 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <p className="m-0 text-[12px] leading-snug text-warning">
            内容存在截断标记，记录大小 {formatBytes(sizeBytes)}；展示的是已捕获的部分。
          </p>
        </div>
      ) : null}

      {tooLarge ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-line bg-surface-2 px-3 py-3">
          <p className="m-0 text-[13px] text-fg-soft">
            内容较大（{formatBytes(sizeBytes)}），已折叠以免阻塞渲染。
          </p>
          <Button size="sm" variant="secondary" onClick={() => setExpanded(true)}>
            <UnfoldVertical className="size-3.5" />
            展开查看
          </Button>
        </div>
      ) : activeMode === "tree" ? (
        <JsonTree data={view.jsonData} query={query} withToolbar toolbarExtra={actions} />
      ) : activeMode === "sse" ? (
        <SseEventList
          events={view.sseEvents ?? []}
          truncated={view.truncated}
          query={query}
          toolbarExtra={actions}
        />
      ) : activeMode === "table" && view.csvTable ? (
        <ViewerFrame>
          <ViewerToolbar>
            <span className="font-mono text-[11px] text-fg-dim">
              {view.csvTable.totalRows} 行 · {view.csvTable.headers.length} 列
            </span>
            {actions}
          </ViewerToolbar>
          <ViewerBody className="px-2">
            <CsvTable
              headers={view.csvTable.headers}
              rows={view.csvTable.rows}
              totalRows={view.csvTable.totalRows}
              visibleRows={view.csvTable.visibleRows}
            />
          </ViewerBody>
        </ViewerFrame>
      ) : activeMode === "preview" ? (
        <ViewerFrame>
          <ViewerToolbar>
            <span className="font-mono text-[11px] text-fg-dim">富文本预览</span>
            {actions}
          </ViewerToolbar>
          <ViewerBody className="px-3 py-2">
            <div
              className="rich-preview"
              dangerouslySetInnerHTML={{ __html: view.previewHtml }}
            />
          </ViewerBody>
        </ViewerFrame>
      ) : activeMode === "raw" ? rawNode : null}

      {view.note && view.mode !== "empty" && !view.truncated ? (
        <p className="m-0 text-[11px] leading-snug text-fg-dim">{view.note}</p>
      ) : null}
    </div>
  );
};
