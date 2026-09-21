import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ProxyRule, ProxyRuleActionType } from "@proxira/core";
import { Button } from "../ui/Button";
import { Field, Input, Textarea } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { Pill } from "../ui/Pill";
import { Select } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import { Tooltip } from "../ui/Tooltip";
import { EmptyState } from "../ui/EmptyState";
import { cn } from "../../lib/cn";

// 「Mock 响应」已经搬到设置 → Mock 拦截（全局分组、命中即返回）。
// 这里只剩**故障注入**：仍然会打到上游，只是在去程或回程上做手脚。
const ACTION_OPTIONS = [
  { value: "error", label: "直接失败", hint: "模拟网络/上游异常" },
  { value: "delay", label: "仅延迟", hint: "延迟后正常转发" },
  { value: "break_stream", label: "中断流", hint: "推送若干帧后断开" },
  { value: "truncate", label: "截断响应", hint: "只保留前 N 字节" },
] as const satisfies ReadonlyArray<{ value: ProxyRuleActionType; label: string; hint: string }>;

const METHOD_OPTIONS = [
  { value: "", label: "任意 Method" },
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
  { value: "DELETE", label: "DELETE" },
  { value: "OPTIONS", label: "OPTIONS" },
  { value: "HEAD", label: "HEAD" },
] as const;

const actionTone: Record<ProxyRuleActionType, "accent" | "danger" | "warning" | "info" | "neutral"> =
  {
    mock: "accent",
    error: "danger",
    delay: "info",
    break_stream: "warning",
    truncate: "warning",
  };

type Draft = {
  id: string | null;
  enabled: boolean;
  name: string;
  matchPath: string;
  matchMethod: string;
  delayMs: string;
  action: ProxyRuleActionType;
  status: string;
  headersText: string;
  body: string;
  stream: boolean;
  chunkIntervalMs: string;
  message: string;
  afterChunks: string;
  keepBytes: string;
};

const emptyDraft: Draft = {
  id: null,
  enabled: true,
  name: "",
  matchPath: "/",
  matchMethod: "",
  delayMs: "0",
  action: "error",
  status: "200",
  headersText: "",
  body: "",
  stream: false,
  chunkIntervalMs: "120",
  message: "Simulated upstream failure.",
  afterChunks: "2",
  keepBytes: "1024",
};

const toDraft = (rule: ProxyRule): Draft => ({
  id: rule.id,
  enabled: rule.enabled,
  name: rule.name,
  matchPath: rule.matchPath,
  matchMethod: rule.matchMethod ?? "",
  delayMs: String(rule.delayMs),
  action: rule.action,
  status: String(rule.status),
  headersText: JSON.stringify(rule.headers ?? {}, null, 2),
  body: rule.body,
  stream: rule.stream,
  chunkIntervalMs: String(rule.chunkIntervalMs),
  message: rule.message,
  afterChunks: String(rule.afterChunks),
  keepBytes: String(rule.keepBytes),
});

const parseHeaders = (text: string): Record<string, string> => {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // 交给调用方提示。
  }
  return {};
};

export const RuleManagerModal = ({
  open,
  onOpenChange,
  rules,
  onCreate,
  onUpdate,
  onRemove,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: ProxyRule[];
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (payload: { id: string; patch: Record<string, unknown> }) => Promise<void>;
  onRemove: (id: string) => void;
  onToggle: (rule: ProxyRule) => void;
}) => {
  const [draft, setDraft] = useState<Draft | null>(null);

  const patch = (next: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  const headersValid = useMemo(() => {
    if (!draft?.headersText.trim()) return true;
    try {
      const parsed = JSON.parse(draft.headersText) as unknown;
      return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, [draft?.headersText]);

  const submit = async (): Promise<void> => {
    if (!draft) return;
    const headers = parseHeaders(draft.headersText);
    const int = (value: string, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
    };

    const payload: Record<string, unknown> = {
      enabled: draft.enabled,
      // wire 契约：name / matchPath 不接受空字符串，服务端 schema 会 400。
      name: draft.name.trim() || "未命名规则",
      matchPath: draft.matchPath.trim() || "/",
      matchMethod: draft.matchMethod.trim() ? draft.matchMethod.trim().toUpperCase() : null,
      delayMs: int(draft.delayMs, 0),
      action: draft.action,
      status: int(draft.status, 200),
      headers,
      body: draft.body,
      stream: draft.stream,
      chunkIntervalMs: int(draft.chunkIntervalMs, 120),
      message: draft.message,
      afterChunks: int(draft.afterChunks, 2),
      keepBytes: int(draft.keepBytes, 1024),
    };

    if (draft.id) {
      await onUpdate({ id: draft.id, patch: payload });
    } else {
      await onCreate(payload);
    }
    setDraft(null);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="故障注入规则"
      description="让上游「出错」而不是替它回答：延迟、直接失败、中断流、截断响应。要自定义响应内容请到设置 → Mock 拦截。"
      width="xl"
      footer={
        draft ? (
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button variant="primary" disabled={!headersValid} onClick={() => void submit()}>
              {draft.id ? "保存规则" : "创建规则"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setDraft({ ...emptyDraft })}>
            <Plus className="size-4" />
            新增规则
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {rules.length === 0 && !draft ? (
          <EmptyState
            title="还没有故障注入规则"
            hint="新增一条规则，用路径片段 + Method 匹配要「搞坏」的请求。"
            action={
              <Button variant="secondary" size="sm" onClick={() => setDraft({ ...emptyDraft })}>
                <Plus className="size-4" />
                新增规则
              </Button>
            }
          />
        ) : null}

        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className={cn(
                "flex flex-wrap items-center gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-2.5",
                !rule.enabled && "opacity-60",
              )}
            >
              <Toggle
                checked={rule.enabled}
                onCheckedChange={() => onToggle(rule)}
                label={`${rule.enabled ? "停用" : "启用"}规则 ${rule.name}`}
              />

              <div className="min-w-[160px] flex-1">
                <p className="m-0 truncate font-medium text-[14px]">{rule.name}</p>
                <p className="m-0 truncate font-mono text-[11px] text-fg-dim">
                  {rule.matchMethod ?? "ANY"} · {rule.matchPath}
                  {rule.delayMs > 0 ? ` · +${rule.delayMs}ms` : ""}
                </p>
              </div>

              <Pill tone={actionTone[rule.action]}>
                {ACTION_OPTIONS.find((option) => option.value === rule.action)?.label ?? rule.action}
              </Pill>

              <div className="flex items-center gap-1">
                <Tooltip label="编辑规则">
                  <IconButton
                    label="编辑规则"
                    className="size-7 [&_svg]:size-3.5"
                    onClick={() => setDraft(toDraft(rule))}
                  >
                    <Pencil />
                  </IconButton>
                </Tooltip>
                <Tooltip label="删除规则">
                  <IconButton
                    label="删除规则"
                    tone="danger"
                    className="size-7 [&_svg]:size-3.5"
                    onClick={() => onRemove(rule.id)}
                  >
                    <Trash2 />
                  </IconButton>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>

        {draft ? (
          <div className="flex flex-col gap-3 rounded-md border border-accent/40 bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-[15px] font-semibold">
                {draft.id ? "编辑规则" : "新增规则"}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-fg-soft">启用</span>
                <Toggle
                  checked={draft.enabled}
                  onCheckedChange={(value) => patch({ enabled: value })}
                  label="启用该规则"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Field label="名称" className="min-w-0 flex-1">
                <Input
                  value={draft.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  placeholder="未命名规则"
                />
              </Field>
              <Field label="匹配 Method" className="sm:w-[160px]">
                <Select
                  label="匹配 Method"
                  value={draft.matchMethod}
                  onChange={(value) => patch({ matchMethod: value })}
                  options={METHOD_OPTIONS}
                />
              </Field>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Field label="匹配路径片段" hint="请求路径包含该片段即命中，填 / 表示全部" className="min-w-0 flex-1">
                <Input
                  value={draft.matchPath}
                  onChange={(event) => patch({ matchPath: event.target.value })}
                  placeholder="/api/orders"
                />
              </Field>
              <Field label="额外延迟 (ms)" className="sm:w-[150px]">
                <Input
                  value={draft.delayMs}
                  onChange={(event) => patch({ delayMs: event.target.value })}
                  inputMode="numeric"
                />
              </Field>
            </div>

            <Field label="动作">
              <Select
                label="动作"
                value={draft.action}
                onChange={(value) => patch({ action: value })}
                options={ACTION_OPTIONS}
              />
            </Field>

            {draft.action === "mock" ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Field label="响应状态码" className="sm:w-[150px]">
                    <Input
                      value={draft.status}
                      onChange={(event) => patch({ status: event.target.value })}
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="流式推送" hint="按行逐帧发送正文" className="min-w-0 flex-1">
                    <div className="flex min-h-10 items-center gap-2">
                      <Toggle
                        checked={draft.stream}
                        onCheckedChange={(value) => patch({ stream: value })}
                        label="流式推送"
                      />
                      <span className="text-[13px] text-fg-soft">
                        {draft.stream ? "逐帧发送" : "一次性返回"}
                      </span>
                    </div>
                  </Field>
                  {draft.stream ? (
                    <Field label="帧间隔 (ms)" className="sm:w-[150px]">
                      <Input
                        value={draft.chunkIntervalMs}
                        onChange={(event) => patch({ chunkIntervalMs: event.target.value })}
                        inputMode="numeric"
                      />
                    </Field>
                  ) : null}
                </div>

                <Field label="响应 Headers" hint='JSON 对象，例如 { "content-type": "application/json" }'>
                  <Textarea
                    rows={2}
                    value={draft.headersText}
                    onChange={(event) => patch({ headersText: event.target.value })}
                  />
                </Field>

                <Field label="响应正文">
                  <Textarea
                    rows={4}
                    value={draft.body}
                    onChange={(event) => patch({ body: event.target.value })}
                  />
                </Field>
              </>
            ) : null}

            {draft.action === "error" ? (
              <Field label="失败信息">
                <Input
                  value={draft.message}
                  onChange={(event) => patch({ message: event.target.value })}
                />
              </Field>
            ) : null}

            {draft.action === "break_stream" ? (
              <Field label="推送帧数后断开">
                <Input
                  value={draft.afterChunks}
                  onChange={(event) => patch({ afterChunks: event.target.value })}
                  inputMode="numeric"
                />
              </Field>
            ) : null}

            {draft.action === "truncate" ? (
              <Field label="保留字节数">
                <Input
                  value={draft.keepBytes}
                  onChange={(event) => patch({ keepBytes: event.target.value })}
                  inputMode="numeric"
                />
              </Field>
            ) : null}

            {!headersValid ? (
              <p className="m-0 text-[12px] text-danger">
                响应 Headers 不是合法的 JSON 对象，请检查后再保存。
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
};
