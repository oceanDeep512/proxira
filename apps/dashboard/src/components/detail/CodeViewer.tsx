import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import http from "highlight.js/lib/languages/http";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, Copy, WrapText } from "lucide-react";
import { writeClipboard } from "../../hooks/useCopy";
import { toast } from "../../store/toast";
import { cn } from "../../lib/cn";

// 只注册面板真正会遇到的语法，别把整包 highlight.js 拉进 bundle。
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("http", http);

const MAX_RENDER_LINES = 1500;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const decodeEntity = (entity: string): string => ENTITIES[entity] ?? entity;

type Token = { kind: "tag"; html: string } | { kind: "text"; text: string };

/** 把 highlight.js 输出的 HTML 拆成「标签 / 文本」，文本部分已解码。 */
const tokenize = (html: string): Token[] => {
  const tokens: Token[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (buffer) {
      // 先按实体切分再解码，保证解码后的长度与源码字符数一致。
      const text = buffer.replace(/&[a-zA-Z#0-9x]+;/g, decodeEntity);
      tokens.push({ kind: "text", text });
      buffer = "";
    }
  };

  while (index < html.length) {
    if (html[index] === "<") {
      const end = html.indexOf(">", index);
      if (end === -1) {
        buffer += html.slice(index);
        break;
      }
      flush();
      tokens.push({ kind: "tag", html: html.slice(index, end + 1) });
      index = end + 1;
      continue;
    }
    buffer += html[index];
    index += 1;
  }
  flush();
  return tokens;
};

/**
 * 整段高亮后按行切分，跨行的 <span> 在行尾闭合、行首重开，
 * 这样每行都能独立塞进一个 flex 行（行号才对得齐）。
 */
const splitHighlightedLines = (html: string): string[] => {
  const lines: string[] = [];
  const openTags: string[] = [];
  let buffer = "";
  let index = 0;

  while (index < html.length) {
    if (html.startsWith("\n", index)) {
      buffer += openTags.map(() => "</span>").join("");
      lines.push(buffer);
      buffer = openTags.join("");
      index += 1;
      continue;
    }
    if (html.startsWith("<span", index)) {
      const end = html.indexOf(">", index);
      if (end === -1) {
        buffer += html.slice(index);
        break;
      }
      const tag = html.slice(index, end + 1);
      openTags.push(tag);
      buffer += tag;
      index = end + 1;
      continue;
    }
    if (html.startsWith("</span>", index)) {
      openTags.pop();
      buffer += "</span>";
      index += 7;
      continue;
    }
    buffer += html[index];
    index += 1;
  }
  buffer += openTags.map(() => "</span>").join("");
  lines.push(buffer);
  return lines;
};

type Range = { start: number; end: number; active: boolean };

/** 在已高亮的 HTML 里插入 <mark>，只动文本节点，不破坏标签结构。 */
const applyMarks = (html: string, ranges: Range[]): string => {
  if (ranges.length === 0) return html;
  let output = "";
  let offset = 0;
  let cursor = 0;

  for (const token of tokenize(html)) {
    if (token.kind === "tag") {
      output += token.html;
      continue;
    }
    let textPos = 0;
    while (cursor < ranges.length && textPos < token.text.length) {
      const range = ranges[cursor];
      if (range.start >= offset + token.text.length) break;
      const start = Math.max(0, range.start - offset);
      if (start > textPos) {
        output += escapeHtml(token.text.slice(textPos, start));
        textPos = start;
      }
      const end = Math.min(range.end - offset, token.text.length);
      if (end <= textPos) break;
      output += `<mark class="${range.active ? "code-mark-active" : "code-mark"}">${escapeHtml(
        token.text.slice(textPos, end),
      )}</mark>`;
      textPos = end;
      if (range.end - offset <= token.text.length) cursor += 1;
      else break;
    }
    if (textPos < token.text.length) output += escapeHtml(token.text.slice(textPos));
    offset += token.text.length;
  }
  return output;
};

export type CodeLanguage = "json" | "xml" | "yaml" | "markdown" | "http" | "text";

/** 按 body 解析出的格式挑一个高亮语法，猜不出来就退回纯文本。 */
export const languageForMode = (mode: string): CodeLanguage => {
  switch (mode) {
    case "json":
      return "json";
    case "xml":
    case "html":
      return "xml";
    case "yaml":
      return "yaml";
    case "markdown":
      return "markdown";
    default:
      return "text";
  }
};

/**
 * 还原浏览器控制台的源码面板：行号 gutter、缩进折叠、语法高亮、
 * 搜索命中高亮 + 上一个/下一个定位、换行开关。
 */
export const CodeViewer = ({
  code,
  language = "text",
  query = "",
  className,
  maxHeight = 560,
  toolbarExtra,
  copyLabel = "内容",
}: {
  code: string;
  language?: CodeLanguage;
  query?: string;
  className?: string;
  maxHeight?: number;
  toolbarExtra?: ReactNode;
  copyLabel?: string;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 控制台默认不换行；长行横向滚，和 DevTools 一致。
  const [wrap, setWrap] = useState(false);
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => new Set());
  const [visibleLines, setVisibleLines] = useState(MAX_RENDER_LINES);
  const [matchIndex, setMatchIndex] = useState(0);

  // 换记录/换视图就是换内容：折叠与分页状态必须一起重置。
  const [codeKey, setCodeKey] = useState(code);
  if (codeKey !== code) {
    setCodeKey(code);
    setFolded(new Set());
    setVisibleLines(MAX_RENDER_LINES);
    setMatchIndex(0);
  }

  const lines = useMemo(() => code.split("\n"), [code]);

  const htmlLines = useMemo(() => {
    if (language === "text") return lines.map(escapeHtml);
    try {
      return splitHighlightedLines(hljs.highlight(code, { language, ignoreIllegals: true }).value);
    } catch {
      return lines.map(escapeHtml);
    }
  }, [code, language, lines]);

  /** 缩进块折叠：第 i 行能折叠到 blockEnd[i]（含）。 */
  const blockEnd = useMemo(() => {
    const indents = lines.map((line) => line.length - line.trimStart().length);
    const ends = new Array<number>(lines.length).fill(-1);
    const stack: number[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      while (stack.length > 0 && indents[i] <= indents[stack[stack.length - 1] ?? 0]) {
        const start = stack.pop();
        if (start !== undefined) ends[start] = i - 1;
      }
      stack.push(i);
    }
    while (stack.length > 0) {
      const start = stack.pop();
      if (start !== undefined) ends[start] = lines.length - 1;
    }
    // 空行、以及没有子行的行不能折叠
    for (let i = 0; i < lines.length; i += 1) {
      if (ends[i] <= i || lines[i].trim().length === 0) ends[i] = -1;
    }
    return ends;
  }, [lines]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const out: Array<{ line: number; start: number; end: number }> = [];
    for (let i = 0; i < lines.length; i += 1) {
      const lower = lines[i]?.toLowerCase() ?? "";
      let from = 0;
      while (from <= lower.length - needle.length) {
        const hit = lower.indexOf(needle, from);
        if (hit === -1) break;
        out.push({ line: i, start: hit, end: hit + needle.length });
        from = hit + needle.length;
      }
    }
    return out;
  }, [lines, query]);

  useEffect(() => {
    setMatchIndex(0);
  }, [query]);

  const currentMatch = matches.length > 0 ? matches[Math.min(matchIndex, matches.length - 1)] : undefined;

  useEffect(() => {
    if (!currentMatch) return;
    const node = scrollRef.current?.querySelector('[data-active-match="true"]');
    node?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [currentMatch?.line, currentMatch?.start]);

  const matchesByLine = useMemo(() => {
    const map = new Map<number, Range[]>();
    if (!currentMatch) return map;
    for (const match of matches) {
      const list = map.get(match.line) ?? [];
      list.push({
        start: match.start,
        end: match.end,
        active: match.line === currentMatch.line && match.start === currentMatch.start,
      });
      map.set(match.line, list);
    }
    return map;
  }, [matches, currentMatch]);

  // 命中项如果落在折叠区间里，就把那一段强制展开，否则搜到了也看不见。
  const effectiveFolded = useMemo(() => {
    if (folded.size === 0 || matches.length === 0) return folded;
    const next = new Set<number>();
    for (const start of folded) {
      const end = blockEnd[start] ?? -1;
      const hidden = matches.some((match) => match.line > start && match.line <= end);
      if (!hidden) next.add(start);
    }
    return next;
  }, [folded, matches, blockEnd]);

  const foldableLines = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < lines.length; i += 1) if ((blockEnd[i] ?? -1) > i) out.push(i);
    return out;
  }, [blockEnd, lines]);

  // 全部折叠 = 把每个可折叠行都记进集合，渲染时最外层那行自然会把其余吃掉。
  const allFolded = foldableLines.length > 0 && foldableLines.every((line) => folded.has(line));
  const toggleFoldAll = (): void =>
    setFolded(allFolded ? new Set<number>() : new Set(foldableLines));

  const toggleFold = (line: number): void =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(line)) next.add(line);
      return next;
    });

  const rows: ReactNode[] = [];
  let skipUntil = -1;
  const renderCount = Math.min(lines.length, visibleLines);

  for (let i = 0; i < renderCount; i += 1) {
    if (i <= skipUntil) continue;
    const end = blockEnd[i] ?? -1;
    const canFold = end > i;
    const isFolded = canFold && effectiveFolded.has(i);
    if (isFolded) skipUntil = end;

    const ranges = matchesByLine.get(i) ?? [];
    const html = ranges.length > 0 ? applyMarks(htmlLines[i] ?? "", ranges) : (htmlLines[i] ?? "");

    rows.push(
      <div key={i} className="code-row flex items-start hover:bg-surface-3/40">
        <span
          aria-hidden
          className={cn(
            "sticky left-0 z-[1] w-10 shrink-0 select-none border-r border-line/70 bg-surface-2",
            "pr-2 text-right font-mono text-[11px] leading-[1.65] text-fg-dim",
          )}
        >
          {i + 1}
        </span>
        {canFold ? (
          <button
            type="button"
            onClick={() => toggleFold(i)}
            aria-label={isFolded ? `展开第 ${i + 1} 行起的 ${end - i} 行` : `折叠第 ${i + 1} 行起的 ${end - i} 行`}
            className={cn(
              "flex h-[21.5px] w-4 shrink-0 items-center justify-center text-fg-dim",
              "transition-colors hover:text-accent",
            )}
          >
            {isFolded ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <code
          className={cn(
            "min-w-0 flex-1 pl-1 pr-3 font-mono text-[13px] leading-[1.65]",
            wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {isFolded ? (
          <button
            type="button"
            onClick={() => toggleFold(i)}
            // sticky right：长行横向滚动时，折叠标记别跟着滚出可视区。
            className="sticky right-0 z-[1] mr-2 shrink-0 rounded-sm bg-surface-3 px-1 text-[11px] text-fg-dim hover:text-accent"
          >
            … {end - i} 行
          </button>
        ) : null}
      </div>,
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-md border border-line bg-surface-2", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-3/50 px-2 py-1">
        {toolbarExtra}

        {foldableLines.length > 0 ? (
          <button
            type="button"
            onClick={toggleFoldAll}
            className={cn(
              "inline-flex min-h-6 items-center gap-1 rounded-sm px-1.5 text-[11px]",
              "text-fg-dim transition-colors hover:bg-surface-3 hover:text-fg",
            )}
          >
            {allFolded ? <ChevronsUpDown className="size-3" /> : <ChevronsDownUp className="size-3" />}
            {allFolded ? "全部展开" : "全部折叠"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setWrap((value) => !value)}
          className={cn(
            "inline-flex min-h-6 items-center gap-1 rounded-sm px-1.5 text-[11px]",
            "text-fg-dim transition-colors hover:bg-surface-3 hover:text-fg",
          )}
        >
          <WrapText className="size-3" />
          {wrap ? "不换行" : "自动换行"}
        </button>

        <button
          type="button"
          onClick={() => {
            void writeClipboard(code).then((ok) => {
              toast[ok ? "success" : "error"](ok ? `已复制${copyLabel}` : "复制失败");
            });
          }}
          className={cn(
            "inline-flex min-h-6 items-center gap-1 rounded-sm px-1.5 text-[11px]",
            "text-fg-dim transition-colors hover:bg-surface-3 hover:text-fg",
          )}
        >
          <Copy className="size-3" />
          复制
        </button>

        <div className="ml-auto flex items-center gap-1">
          {query.trim().length > 0 && matches.length === 0 ? (
            <span className="font-mono text-[11px] text-warning">无匹配</span>
          ) : null}

          {matches.length > 0 ? (
            <>
              <span className="font-mono text-[11px] text-fg-dim">
                {Math.min(matchIndex + 1, matches.length)}/{matches.length}
              </span>
            <button
              type="button"
              aria-label="上一个匹配"
              onClick={() =>
                setMatchIndex((value) => (value - 1 + matches.length) % matches.length)
              }
              className="rounded-sm p-0.5 text-fg-dim hover:bg-surface-3 hover:text-fg"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="下一个匹配"
              onClick={() => setMatchIndex((value) => (value + 1) % matches.length)}
              className="rounded-sm p-0.5 text-fg-dim hover:bg-surface-3 hover:text-fg"
            >
              <ChevronDown className="size-3.5" />
            </button>
            </>
          ) : null}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="overflow-auto py-1"
        style={{ maxHeight }}
      >
        {rows}
        {lines.length > renderCount ? (
          <button
            type="button"
            onClick={() => setVisibleLines((value) => value + MAX_RENDER_LINES)}
            className="ml-11 my-1 rounded-sm px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent-soft"
          >
            继续渲染 {Math.min(MAX_RENDER_LINES, lines.length - renderCount)} / 剩余{" "}
            {lines.length - renderCount} 行
          </button>
        ) : null}
      </div>
    </div>
  );
};
