import { useState } from "react";
import { Lock } from "lucide-react";
import type { ProxyHeaders } from "@proxira/core";
import { isSensitiveKey } from "../../lib/redact";
import { JsonTree } from "./JsonTree";
import { Segmented } from "../ui/Segmented";
import { EmptyState } from "../ui/EmptyState";
import { cn } from "../../lib/cn";

type View = "table" | "json";

/** Headers 用键值表比 JSON 树好读：字段名一眼看全，值可整段换行。 */
export const HeadersView = ({
  headers,
  query = "",
}: {
  headers: ProxyHeaders;
  query?: string;
}) => {
  const [view, setView] = useState<View>("table");
  const entries = Object.entries(headers);

  if (entries.length === 0) {
    return <EmptyState title="没有 Header" hint="这个方向没有记录到任何请求头。" />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] text-fg-soft">{entries.length} 个字段</span>
        <Segmented
          ariaLabel="Header 视图"
          value={view}
          onChange={setView}
          options={[
            { value: "table", label: "键值表" },
            { value: "json", label: "JSON" },
          ]}
        />
      </div>

      {view === "table" ? (
        <div className="max-h-[520px] overflow-auto rounded-md border border-line">
          <table className="px-table">
            <thead>
              <tr>
                <th className="w-[min(240px,38%)]">Name</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([name, value]) => {
                const sensitive = isSensitiveKey(name);
                const text = Array.isArray(value) ? value.join("\n") : value;
                return (
                  <tr key={name}>
                    <td className="w-[min(240px,38%)]">
                      <span
                        className={cn(
                          "flex items-start gap-1.5 font-mono text-[12px] font-medium",
                          sensitive ? "text-danger" : "text-info",
                        )}
                      >
                        {sensitive ? <Lock className="mt-0.5 size-3 shrink-0" /> : null}
                        <span className="break-all">{name}</span>
                      </span>
                    </td>
                    <td className="whitespace-pre-wrap break-all font-mono text-[12px] text-fg">
                      {text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <JsonTree data={headers} query={query} />
      )}
    </div>
  );
};
