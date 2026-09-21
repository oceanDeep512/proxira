import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { ProxyMockRule } from "@proxira/core";
import { useProxiraStore } from "../../store/proxira";
import { Button } from "../ui/Button";
import { Field, Input, Textarea } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { Pill } from "../ui/Pill";
import { Select } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import { EmptyState } from "../ui/EmptyState";
import { GroupList } from "./GroupList";
import { cn } from "../../lib/cn";

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

type RuleDraft = {
  id: string;
  name: string;
  enabled: boolean;
  matchPath: string;
  matchMethod: string;
  delayMs: string;
  status: string;
  headersText: string;
  body: string;
  stream: boolean;
  chunkIntervalMs: string;
};

const draftId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
};

const toDraft = (rule: ProxyMockRule): RuleDraft => ({
  id: rule.id,
  name: rule.name,
  enabled: rule.enabled,
  matchPath: rule.matchPath,
  matchMethod: rule.matchMethod ?? "",
  delayMs: String(rule.delayMs),
  status: String(rule.status),
  headersText: JSON.stringify(rule.headers ?? {}, null, 2),
  body: rule.body,
  stream: rule.stream,
  chunkIntervalMs: String(rule.chunkIntervalMs),
});

const newRule = (): RuleDraft => ({
  id: draftId(),
  name: "",
  enabled: true,
  matchPath: "/",
  matchMethod: "",
  delayMs: "0",
  status: "200",
  headersText: "",
  body: "",
  stream: false,
  chunkIntervalMs: "120",
});

const parseHeaders = (text: string): Record<string, string> | null => {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    return null;
  }
  return null;
};

const int = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

/**
 * Mock 拦截分组编辑器。
 *
 * 一个分组 = 多条接口规则；分组是**全局**的，在「编辑转发地址」里勾选生效。
 * 命中即返回，请求根本不会打到上游 —— 这是它和「故障注入」（延迟/错误/断流/截断，
 * 仍然按转发地址配置）的分界线。
 *
 * 匹配顺序：按勾选的分组顺序逐个问，组内第一条命中的规则胜出。
 * 所以分组顺序和组内规则顺序都是有意义的，列表都自带上移/下移（组内靠展开后拖动？
 * 没有做拖拽，规则顺序 = 列表顺序，删除重建即可调整）。
 *
 * 保存是「整组一起存」：规则随分组一次性提交，服务端整体替换，
 * 不会出现改了一条把别的弄丢的情况。
 */
export const MockGroupEditor = ({
  onOpenFaultRules,
}: {
  /** 打开故障注入规则弹窗（延迟 / 错误 / 断流 / 截断）。 */
  onOpenFaultRules: () => void;
}) => {
  const groups = useProxiraStore((state) => state.mockGroups);
  const targets = useProxiraStore((state) => state.targets);
  const createMockGroup = useProxiraStore((state) => state.createMockGroup);
  const saveMockGroup = useProxiraStore((state) => state.saveMockGroup);
  const removeMockGroup = useProxiraStore((state) => state.removeMockGroup);
  const moveMockGroup = useProxiraStore((state) => state.moveMockGroup);

  const [selectedId, setSelectedId] = useState("");
  const activeId = groups.some((item) => item.id === selectedId)
    ? selectedId
    : (groups[0]?.id ?? "");
  const group = groups.find((item) => item.id === activeId) ?? null;

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 只在切换分组时灌入草稿：跟随 props 会让打字过程中被 SSE 推来的新配置覆盖掉。
  useEffect(() => {
    setName(group?.name ?? "");
    setEnabled(group?.enabled ?? true);
    setRules((group?.rules ?? []).map(toDraft));
    setExpandedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const patchRule = (id: string, patch: Partial<RuleDraft>): void =>
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );

  const invalidHeadersId = useMemo(() => {
    for (const rule of rules) {
      if (parseHeaders(rule.headersText) === null) return rule.id;
    }
    return null;
  }, [rules]);

  const submit = async (): Promise<void> => {
    if (!group || invalidHeadersId) return;
    setSaving(true);
    try {
      await saveMockGroup(group.id, {
        name: name.trim() || group.name,
        enabled,
        rules: rules.map((rule): ProxyMockRule => ({
          id: rule.id,
          name: rule.name.trim() || "未命名接口",
          enabled: rule.enabled,
          matchPath: rule.matchPath.trim() || "/",
          matchMethod: rule.matchMethod.trim() ? rule.matchMethod.trim().toUpperCase() : null,
          delayMs: Math.max(0, int(rule.delayMs, 0)),
          status: Math.min(599, Math.max(100, int(rule.status, 200))),
          headers: parseHeaders(rule.headersText) ?? {},
          body: rule.body,
          stream: rule.stream,
          chunkIntervalMs: Math.max(0, int(rule.chunkIntervalMs, 120)),
        })),
      });
    } finally {
      setSaving(false);
    }
  };

  const usedBy = group
    ? targets.filter((target) => target.mockGroupIds.includes(group.id))
    : [];

  const addRule = (): void => {
    const created = newRule();
    setRules((current) => [...current, created]);
    setExpandedId(created.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
        分组是全局的：在这里定义接口，在
        <strong className="mx-1 font-medium text-fg">编辑转发地址</strong>
        里勾选生效。命中的请求
        <strong className="font-medium text-fg">直接返回，不会打到上游</strong>
        。按下方列表顺序逐个分组匹配，组内第一条命中的规则胜出。
      </p>

      <div className="grid gap-4 panel:grid-cols-[220px_minmax(0,1fr)]">
        <GroupList
          title="Mock 分组"
          items={groups.map((item) => ({
            id: item.id,
            name: item.name,
            meta: `${item.rules.length} 条接口${item.enabled ? "" : " · 已停用"}`,
          }))}
          selectedId={activeId}
          onSelect={setSelectedId}
          onCreate={() => {
            void createMockGroup(`Mock 分组 ${groups.length + 1}`).then((id) => {
              if (id) setSelectedId(id);
            });
          }}
          onDelete={(id) => void removeMockGroup(id)}
          onMove={(id, direction) => void moveMockGroup(id, direction)}
          emptyHint="还没有 Mock 分组。新建一个，把同一批接口的假数据收在一起。"
        />

        {!group ? (
          <EmptyState
            title="还没有 Mock 分组"
            hint="新建分组后可以往里面加多条接口规则，再在转发地址上勾选生效。"
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="px-title-eyebrow">分组名称</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：订单接口 v2"
                aria-label="分组名称"
                className="min-h-9"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="m-0 text-[11px] leading-relaxed text-fg-dim">
                  {usedBy.length > 0
                    ? `已被 ${usedBy.length} 个转发地址引用：${usedBy.map((target) => target.name).join("、")}`
                    : "还没有转发地址引用这个分组。"}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[12px] text-fg-soft">整组启用</span>
                  <Toggle
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    label={`${enabled ? "停用" : "启用"}整个分组`}
                  />
                </div>
              </div>
            </div>

            <section className="flex flex-col gap-2.5 border-t border-line pt-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="m-0 font-display text-[14px] font-semibold text-fg">接口规则</h3>
                  <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
                    路径片段匹配（大小写不敏感），可叠加 Method 过滤；组内第一条命中的规则生效。
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={addRule}>
                  <Plus className="size-4" />
                  添加接口
                </Button>
              </div>

              {rules.length === 0 ? (
                <p className="m-0 rounded-md border border-dashed border-line px-3 py-3 text-[12px] text-fg-dim">
                  还没有接口规则。添加一条，命中后直接返回你写的响应。
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {rules.map((rule) => {
                    const expanded = expandedId === rule.id;
                    return (
                      <li
                        key={rule.id}
                        className={cn(
                          "rounded-md border bg-surface-2",
                          expanded ? "border-accent/45" : "border-line",
                          !rule.enabled && "opacity-60",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <Toggle
                            checked={rule.enabled}
                            onCheckedChange={(value) => patchRule(rule.id, { enabled: value })}
                            label={`${rule.enabled ? "停用" : "启用"}接口 ${rule.name || "未命名"}`}
                          />

                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : rule.id)}
                            aria-expanded={expanded}
                            className="flex min-w-[140px] flex-1 flex-col items-start gap-0.5 text-left"
                          >
                            <span className="max-w-full truncate text-[13px] font-medium text-fg">
                              {rule.name || "未命名接口"}
                            </span>
                            <span className="max-w-full truncate font-mono text-[11px] text-fg-dim">
                              {rule.matchMethod || "ANY"} · {rule.matchPath || "/"}
                              {int(rule.delayMs, 0) > 0 ? ` · +${rule.delayMs}ms` : ""}
                            </span>
                          </button>

                          <Pill tone={expanded ? "accent" : "neutral"}>{rule.status || "200"}</Pill>
                          {rule.stream ? <Pill tone="info">流式</Pill> : null}

                          <IconButton
                            label={expanded ? "收起该接口" : "展开编辑该接口"}
                            className="size-7 [&_svg]:size-3.5"
                            onClick={() => setExpandedId(expanded ? null : rule.id)}
                          >
                            <ChevronDown
                              className={cn("transition-transform", expanded && "rotate-180")}
                            />
                          </IconButton>

                          <IconButton
                            label="删除该接口"
                            tone="danger"
                            className="size-7 [&_svg]:size-3.5"
                            onClick={() =>
                              setRules((current) =>
                                current.filter((item) => item.id !== rule.id),
                              )
                            }
                          >
                            <Trash2 />
                          </IconButton>
                        </div>

                        {expanded ? (
                          <div className="flex flex-col gap-3 border-t border-line/70 px-3 py-3">
                            <div className="flex flex-col gap-3 hub:flex-row">
                              <Field label="接口名称" className="min-w-0 flex-1">
                                <Input
                                  value={rule.name}
                                  onChange={(event) =>
                                    patchRule(rule.id, { name: event.target.value })
                                  }
                                  placeholder="例如：订单详情"
                                  className="min-h-9"
                                />
                              </Field>
                              <Field label="匹配 Method" className="hub:w-[150px]">
                                <Select
                                  label="匹配 Method"
                                  value={rule.matchMethod}
                                  onChange={(value) =>
                                    patchRule(rule.id, { matchMethod: value })
                                  }
                                  options={METHOD_OPTIONS}
                                  compact
                                />
                              </Field>
                            </div>

                            <div className="flex flex-col gap-3 hub:flex-row">
                              <Field
                                label="匹配路径片段"
                                hint="请求路径包含该片段即命中，填 / 表示全部"
                                className="min-w-0 flex-1"
                              >
                                <Input
                                  value={rule.matchPath}
                                  onChange={(event) =>
                                    patchRule(rule.id, { matchPath: event.target.value })
                                  }
                                  placeholder="/api/orders"
                                  className="min-h-9 font-mono text-[13px]"
                                />
                              </Field>
                              <Field label="响应延迟 (ms)" className="hub:w-[120px]">
                                <Input
                                  value={rule.delayMs}
                                  onChange={(event) =>
                                    patchRule(rule.id, { delayMs: event.target.value })
                                  }
                                  inputMode="numeric"
                                  className="min-h-9"
                                />
                              </Field>
                              <Field label="状态码" className="hub:w-[110px]">
                                <Input
                                  value={rule.status}
                                  onChange={(event) =>
                                    patchRule(rule.id, { status: event.target.value })
                                  }
                                  inputMode="numeric"
                                  className="min-h-9"
                                />
                              </Field>
                            </div>

                            <div className="flex flex-wrap items-center gap-4">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] text-fg-soft">流式推送（SSE）</span>
                                <Toggle
                                  checked={rule.stream}
                                  onCheckedChange={(value) =>
                                    patchRule(rule.id, { stream: value })
                                  }
                                  label={`${rule.stream ? "关闭" : "开启"}流式推送`}
                                />
                              </div>
                              {rule.stream ? (
                                <Field label="帧间隔 (ms)" className="w-[120px]">
                                  <Input
                                    value={rule.chunkIntervalMs}
                                    onChange={(event) =>
                                      patchRule(rule.id, { chunkIntervalMs: event.target.value })
                                    }
                                    inputMode="numeric"
                                    className="min-h-9"
                                  />
                                </Field>
                              ) : null}
                            </div>

                            <Field
                              label="响应 Headers"
                              hint='JSON 对象，例如 { "content-type": "application/json" }；留空则按正文自动补'
                            >
                              <Textarea
                                rows={2}
                                value={rule.headersText}
                                onChange={(event) =>
                                  patchRule(rule.id, { headersText: event.target.value })
                                }
                              />
                            </Field>
                            {parseHeaders(rule.headersText) === null ? (
                              <p className="m-0 text-[12px] text-danger">
                                响应 Headers 不是合法的 JSON 对象，请检查后再保存。
                              </p>
                            ) : null}

                            <Field
                              label="响应正文"
                              hint={
                                rule.stream
                                  ? "按空行分段，每段作为一帧推送"
                                  : "原样返回，通常写 JSON"
                              }
                            >
                              <Textarea
                                rows={5}
                                value={rule.body}
                                onChange={(event) =>
                                  patchRule(rule.id, { body: event.target.value })
                                }
                              />
                            </Field>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
              <Button
                variant="primary"
                disabled={saving || invalidHeadersId !== null}
                onClick={() => void submit()}
              >
                {saving ? "保存中…" : "保存分组"}
              </Button>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-line pt-4">
              <p className="m-0 text-[12px] leading-relaxed text-fg-dim">
                需要的是「让上游出错」而不是「替上游回答」吗？延迟、直接失败、中断流、截断响应
                这些故障注入规则仍然按转发地址配置，不在这里。
              </p>
              <Button variant="ghost" size="sm" className="w-fit" onClick={onOpenFaultRules}>
                打开故障注入规则
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
