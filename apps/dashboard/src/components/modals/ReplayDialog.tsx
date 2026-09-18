import { useEffect, useState } from "react";
import type { ProxyTrafficRecord } from "@proxira/core";
import { collapseUnchanged, diffLines, diffStats } from "../../lib/diff";
import { redactText } from "../../lib/redact";
import type { ReplayResult } from "../../store/proxira";
import { Button } from "../ui/Button";
import { Field, Input, Textarea } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { Pill } from "../ui/Pill";
import { cn } from "../../lib/cn";

export const ReplayDialog = ({
  open,
  onOpenChange,
  record,
  loading,
  redact,
  onOpenChangeResult,
  onSubmit,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: ProxyTrafficRecord | null;
  loading: boolean;
  redact: boolean;
  result: ReplayResult | null;
  onOpenChangeResult: (result: ReplayResult | null) => void;
  onSubmit: (payload: {
    method: string;
    url: string;
    headersText: string;
    body: string;
  }) => void;
}) => {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open || !record) return;
    setMethod(record.method);
    setUrl(record.upstreamUrl);
    setHeadersText(
      Object.entries(record.requestHeaders)
        .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join("\n"),
    );
    setBody(record.requestBody.text ?? "");
    onOpenChangeResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id]);

  const originalBody = record?.responseBody?.text ?? "";
  const replayBody = result?.body ?? "";

  const before = redact ? redactText(originalBody) : originalBody;
  const after = redact ? redactText(replayBody) : replayBody;

  const rows = result ? collapseUnchanged(diffLines(before, after)) : [];
  const stats = result ? diffStats(diffLines(originalBody, replayBody)) : { added: 0, removed: 0 };

  const tone = !result ? "neutral" : !result.ok ? "danger" : (result.status ?? 0) >= 500 ? "danger" : (result.status ?? 0) >= 400 ? "warning" : "success";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="重放请求"
      description="直接向上游重发这条请求，可先修改内容；响应会与新记录一并进入历史。"
      width="lg"
      footer={
        <Button
          variant="primary"
          disabled={loading}
          onClick={() => onSubmit({ method, url, headersText, body })}
        >
          {loading ? "发送中…" : "发送并重放"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Field label="Method" className="sm:w-[140px]">
            <Input value={method} onChange={(event) => setMethod(event.target.value)} />
          </Field>
          <Field label="URL" className="min-w-0 flex-1">
            <Input value={url} onChange={(event) => setUrl(event.target.value)} inputMode="url" />
          </Field>
        </div>

        <Field label="Headers" hint="每行一个 name: value">
          <Textarea
            rows={3}
            value={headersText}
            onChange={(event) => setHeadersText(event.target.value)}
          />
        </Field>

        <Field label="Body">
          <Textarea rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
        </Field>

        {result ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={tone}>{result.ok ? `${result.status ?? "-"}` : "失败"}</Pill>
              <span className="font-mono text-[12px] text-fg-soft">{result.durationMs} ms</span>
              {result.error ? (
                <span className="text-[12px] text-danger">{result.error}</span>
              ) : (
                <span className="font-mono text-[12px] text-fg-soft">
                  差异：+{stats.added} / -{stats.removed} 行
                </span>
              )}
            </div>

            <div className="max-h-[260px] overflow-auto rounded-md border border-line bg-surface-2 py-1">
              {rows.length === 0 ? (
                <p className="m-0 px-2 py-1 text-[12px] text-fg-soft">两次响应完全一致。</p>
              ) : (
                rows.map((row, index) =>
                  "count" in row ? (
                    <div
                      key={`skip-${index}`}
                      className="px-2 py-0.5 font-mono text-[12px] italic text-fg-dim"
                    >
                      … 省略 {row.count} 行未变更
                    </div>
                  ) : (
                    <div
                      key={`line-${index}`}
                      className={cn(
                        "grid grid-cols-[16px_minmax(0,1fr)] gap-1.5 px-2 font-mono text-[12px]",
                        "whitespace-pre-wrap break-words",
                        row.type === "add" && "bg-success/10 text-success",
                        row.type === "del" && "bg-danger/10 text-danger",
                      )}
                    >
                      <span className="select-none text-fg-dim">
                        {row.type === "add" ? "+" : row.type === "del" ? "-" : " "}
                      </span>
                      <span>{row.text}</span>
                    </div>
                  ),
                )
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
};
