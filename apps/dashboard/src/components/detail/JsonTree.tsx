import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChevronRight, Copy } from "lucide-react";
import { isSensitiveKey } from "../../lib/redact";
import { writeClipboard } from "../../hooks/useCopy";
import { toast } from "../../store/toast";
import { cn } from "../../lib/cn";

/* ------------------------------------------------------------------ *
 * 自研 JSON 树：vue-json-pretty 的替代品
 * 关键差异（也是「解析后展示」的主要增益）：
 *   - 搜索命中自动展开并高亮，命中路径不会被折叠状态挡住
 *   - 大数组分页渲染（默认 100 条），避免一次挂载上万个节点卡死
 *   - 任意节点可复制值 / 复制 JSON Pointer 路径
 * ------------------------------------------------------------------ */

const PAGE_SIZE = 100;

type TreeCtx = {
  collapsed: ReadonlySet<string>;
  toggle: (path: string) => void;
  matchPaths: ReadonlySet<string>;
  query: string;
};

const TreeContext = createContext<TreeCtx>({
  collapsed: new Set(),
  toggle: () => {},
  matchPaths: new Set(),
  query: "",
});

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] =>
  value !== null && typeof value === "object";

const primitiveText = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return String(value);
};

const valueClass = (value: unknown): string => {
  if (typeof value === "string") return "json-value-string";
  if (typeof value === "number" || typeof value === "boolean") return "json-value-number";
  if (value === null || value === undefined) return "json-value-null";
  return "text-fg";
};

/** 把搜索命中处包成 <mark>，不区分大小写。 */
export const highlightMatches = (text: string, query: string): ReactNode => {
  if (!query) return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const hit = lower.indexOf(needle, cursor);
    if (hit === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (hit > cursor) parts.push(text.slice(cursor, hit));
    parts.push(
      <mark key={`${hit}-${cursor}`} className="json-mark">
        {text.slice(hit, hit + needle.length)}
      </mark>,
    );
    cursor = hit + needle.length;
  }
  return parts;
};

const collectMatchPaths = (value: unknown, query: string, path: string, out: Set<string>): boolean => {
  if (!query) return false;
  const needle = query.toLowerCase();
  const selfHit = typeof value === "string" && value.toLowerCase().includes(needle);

  if (isContainer(value)) {
    let child = false;
    const entries: Array<[string, unknown]> = Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value as Record<string, unknown>);
    for (const [key, item] of entries) {
      const childPath = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      const hit =
        key.toLowerCase().includes(needle) || collectMatchPaths(item, query, childPath, out);
      if (hit) child = true;
    }
    if (child || selfHit) out.add(path);
    return child || selfHit;
  }

  const hit = selfHit || primitiveText(value).toLowerCase().includes(needle);
  if (hit) out.add(path);
  return hit;
};

const Row = ({
  depth,
  path,
  children,
  onCopy,
}: {
  depth: number;
  path: string;
  children: ReactNode;
  onCopy?: () => void;
}) => (
  <div
    className="json-row group/row"
    style={{ paddingLeft: `${depth * 14}px` }}
    data-path={path}
  >
    {children}
    {onCopy ? (
      <button
        type="button"
        aria-label="复制该节点"
        onClick={onCopy}
        className={cn(
          "ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-sm",
          "text-fg-dim opacity-0 transition-opacity",
          "hover:text-accent focus-visible:opacity-100 group-hover/row:opacity-100",
        )}
      >
        <Copy className="size-3" />
      </button>
    ) : null}
  </div>
);

const Caret = ({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) => (
  <button
    type="button"
    className="json-caret"
    data-collapsed={collapsed}
    aria-label={collapsed ? "展开" : "折叠"}
    onClick={onClick}
  >
    <ChevronRight className="size-3.5" />
  </button>
);

const JsonNode = ({
  value,
  depth,
  path,
  nodeKey,
  isLast,
}: {
  value: unknown;
  depth: number;
  path: string;
  nodeKey?: string;
  isLast?: boolean;
}) => {
  const { collapsed, toggle, matchPaths, query } = useContext(TreeContext);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [fullText, setFullText] = useState(false);

  const container = isContainer(value);
  // 搜索命中的分支强制展开，否则命中项会被折叠状态藏起来。
  const isCollapsed = container && collapsed.has(path) && !matchPaths.has(path);

  const copyNode = useCallback(() => {
    void writeClipboard(JSON.stringify(value, null, 2)).then((ok) => {
      toast[ok ? "success" : "error"](ok ? "已复制该节点" : "复制失败");
    });
  }, [value]);

  // key 必须整体 shrink-0：全局 `* { min-width: 0 }` 会让 flex 项缩到 0，
  // 长 value 一挤，key 文字就会叠到 value 上。
  const keyPart = nodeKey === undefined ? null : (
    <span className="shrink-0 whitespace-nowrap">
      <span className={cn("json-key", isSensitiveKey(nodeKey) && "json-key-sensitive")}>
        {highlightMatches(`"${nodeKey}"`, query)}
      </span>
      <span className="json-punct">:&nbsp;</span>
    </span>
  );

  if (!container) {
    // base64 / 长 token 之类的值会把树撑成一堵墙：先截断，点击再展开。
    // 搜索时不做截断，否则命中点可能被切掉。
    const clampLong = !query && !fullText && typeof value === "string" && value.length > 240;
    const shownText = clampLong
      ? `"${(value as string).slice(0, 240)}…"`
      : primitiveText(value);

    return (
      <Row depth={depth} path={path} onCopy={copyNode}>
        <span className="w-3.5 shrink-0" />
        {keyPart}
        {/* 不能 flex-1：会把行尾逗号推到最右边，值多长就占多宽 */}
        <span className={cn("min-w-0 break-all", valueClass(value))}>
          {highlightMatches(shownText, query)}
          {clampLong ? (
            <button
              type="button"
              onClick={() => setFullText(true)}
              className="ml-1.5 rounded-sm px-1 text-[11px] text-accent hover:bg-accent-soft"
            >
              展开全部 {(value as string).length} 字符
            </button>
          ) : null}
        </span>
        {isLast ? null : <span className="json-punct">,</span>}
      </Row>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  const visible = entries.slice(0, visibleCount);
  const hidden = entries.length - visible.length;

  return (
    <>
      <Row depth={depth} path={path} onCopy={copyNode}>
        <Caret collapsed={isCollapsed} onClick={() => toggle(path)} />
        {keyPart}
        <span className="json-punct">{open}</span>
        {isCollapsed ? (
          <>
            <button
              type="button"
              onClick={() => toggle(path)}
              className="json-count hover:text-accent"
            >
              {entries.length} {isArray ? "项" : "键"} · 已折叠
            </button>
            <span className="json-punct">{close}</span>
          </>
        ) : (
          <span className="json-count">
            {entries.length} {isArray ? "项" : "键"}
          </span>
        )}
        {!isCollapsed && isLast ? null : null}
      </Row>

      {!isCollapsed ? (
        <>
          {visible.map(([childKey, childValue], index) => (
            <JsonNode
              key={`${path}/${childKey}-${index}`}
              value={childValue}
              depth={depth + 1}
              path={`${path}/${childKey.replace(/~/g, "~0").replace(/\//g, "~1")}`}
              nodeKey={isArray ? undefined : childKey}
              isLast={index === entries.length - 1}
            />
          ))}

          {hidden > 0 ? (
            <div style={{ paddingLeft: `${(depth + 1) * 14}px` }} className="py-1">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                className="rounded-sm px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent-soft"
              >
                继续渲染 {Math.min(PAGE_SIZE, hidden)} / 剩余 {hidden} 项
              </button>
            </div>
          ) : null}

          <Row depth={depth} path={`${path}/__close`}>
            <span className="w-3.5 shrink-0" />
            <span className="json-punct">
              {close}
              {isLast ? "" : ","}
            </span>
          </Row>
        </>
      ) : null}
    </>
  );
};

const collectContainerPaths = (value: unknown, path: string, out: Set<string>): void => {
  if (!isContainer(value)) return;
  out.add(path);
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries) {
    collectContainerPaths(item, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, out);
  }
};

export const JsonTree = ({
  data,
  query = "",
  className,
  withToolbar = false,
}: {
  data: unknown;
  query?: string;
  className?: string;
  withToolbar?: boolean;
}) => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const matchPaths = useMemo(() => {
    const out = new Set<string>();
    if (query.trim()) collectMatchPaths(data, query.trim(), "", out);
    return out;
  }, [data, query]);

  const containerPaths = useMemo(() => {
    const out = new Set<string>();
    collectContainerPaths(data, "", out);
    return out;
  }, [data]);

  const toggle = useCallback((path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  const ctx = useMemo<TreeCtx>(
    () => ({ collapsed, toggle, matchPaths, query: query.trim() }),
    [collapsed, toggle, matchPaths, query],
  );

  // 换数据（切记录 / 切 tab）时折叠状态没有意义，直接重置。
  const [dataKey, setDataKey] = useState(data);
  if (dataKey !== data) {
    setDataKey(data);
    setCollapsed(new Set());
  }

  const allCollapsed = containerPaths.size > 0 && collapsed.size >= containerPaths.size;

  return (
    <TreeContext.Provider value={ctx}>
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        {withToolbar ? (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-fg-dim">
              {query.trim()
                ? `${matchPaths.size} 处命中 · ${containerPaths.size} 个可折叠节点`
                : `${containerPaths.size} 个可折叠节点`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCollapsed(new Set(containerPaths))}
                className="rounded-sm px-1.5 py-0.5 text-[11px] text-fg-soft hover:bg-surface-3 hover:text-fg"
              >
                全部折叠
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(new Set())}
                className="rounded-sm px-1.5 py-0.5 text-[11px] text-fg-soft hover:bg-surface-3 hover:text-fg"
              >
                全部展开
              </button>
            </div>
          </div>
        ) : null}
        {allCollapsed && withToolbar ? (
          <p className="m-0 text-[11px] text-fg-dim">全部节点已折叠。</p>
        ) : null}
        <div className="json-tree overflow-x-auto">
          <JsonNode value={data} depth={0} path="" />
        </div>
      </div>
    </TreeContext.Provider>
  );
};
