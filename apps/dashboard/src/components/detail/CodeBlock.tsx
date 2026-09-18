import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import http from "highlight.js/lib/languages/http";
import { useMemo, useState, type ReactNode } from "react";
import { WrapText } from "lucide-react";
import { highlightMatches } from "./JsonTree";
import { cn } from "../../lib/cn";

// 只注册面板真正会遇到的语法，别把整包 highlight.js 拉进 bundle。
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("http", http);

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

export const CodeBlock = ({
  code,
  language = "text",
  query = "",
  className,
  maxHeight,
  toolbarExtra,
}: {
  code: string;
  language?: CodeLanguage;
  query?: string;
  className?: string;
  maxHeight?: number;
  toolbarExtra?: ReactNode;
}) => {
  const [wrap, setWrap] = useState(true);

  const html = useMemo(() => {
    if (language === "text") return escapeHtml(code);
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(code);
    }
  }, [code, language]);

  // 有搜索词时改渲染纯文本：hljs 的 HTML 里插 <mark> 会破坏标签结构。
  const searching = query.trim().length > 0;
  const lines = useMemo(() => code.split("\n"), [code]);
  const showGutter = !wrap && !searching && lines.length > 1;

  return (
    <div className={cn("relative min-w-0", className)}>
      <div className="flex items-center justify-end gap-1 pb-1.5">
        {toolbarExtra}
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
      </div>

      <div
        className={cn(
          "flex overflow-hidden rounded-md border border-line bg-surface-2",
          maxHeight ? "overflow-y-auto" : "",
        )}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {showGutter ? (
          <div
            aria-hidden
            className="shrink-0 select-none border-r border-line bg-surface-3 px-2 py-2 text-right font-mono text-[12px] leading-[1.65] text-fg-dim"
          >
            {lines.map((_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
        ) : null}

        {searching ? (
          <pre className="min-w-0 flex-1 overflow-x-auto p-2.5 font-mono text-[13px] leading-[1.65] text-fg">
            {highlightMatches(code, query.trim())}
          </pre>
        ) : (
          <pre
            className={cn(
              "min-w-0 flex-1 p-2.5 font-mono text-[13px] leading-[1.65] text-fg",
              wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre",
            )}
          >
            <code
              className={language === "text" ? undefined : `hljs language-${language}`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
        )}
      </div>
    </div>
  );
};
