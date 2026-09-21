import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ProxyHeaderRuleAction } from "@proxira/core";
import { useProxiraStore } from "../../store/proxira";
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { Select, type SelectOption } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import { EmptyState } from "../ui/EmptyState";
import { GroupList } from "./GroupList";
import { cn } from "../../lib/cn";

const ACTION_OPTIONS = [
  { value: "set", label: "替换为新值", hint: "命中后改写成下面的值" },
  { value: "ignore", label: "忽略不转发", hint: "命中后从出站请求中删除" },
] as const satisfies ReadonlyArray<SelectOption<ProxyHeaderRuleAction>>;

type HeaderDraft = { id: string; name: string; value: string };
type RuleDraft = {
  id: string;
  enabled: boolean;
  namePrefix: string;
  action: ProxyHeaderRuleAction;
  value: string;
};

// crypto.randomUUID 只在安全上下文可用（用局域网 IP + http 打开面板时没有），
// 所以留一个兜底：id 只用于 React key 与服务端识别同一条记录，不需要全局唯一性。
const draftId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
};

/**
 * 请求头分组编辑器。
 *
 * 一个分组 = 若干固定头 + 若干匹配规则，分组是**全局**的：
 * 在「编辑转发地址」里勾选后生效，多个分组按顺序叠加，后面的覆盖前面的。
 * 这样同一套鉴权头可以给多个地址复用，不用在每个地址里抄一遍。
 *
 * 保存是「整组一起存」：服务端按「传了什么就替换什么」处理，
 * 不会出现改了固定头把规则清掉的情况。
 *
 * 校验以服务端为准（非法名称、被代理接管的头都会 400 并带上具体原因），
 * 这里只挡掉整行空白这种「显然后台也存不下」的输入。
 */
export const HeaderPresetEditor = () => {
  const presets = useProxiraStore((state) => state.headerPresets);
  const targets = useProxiraStore((state) => state.targets);
  const createHeaderPreset = useProxiraStore((state) => state.createHeaderPreset);
  const saveHeaderPreset = useProxiraStore((state) => state.saveHeaderPreset);
  const removeHeaderPreset = useProxiraStore((state) => state.removeHeaderPreset);
  const moveHeaderPreset = useProxiraStore((state) => state.moveHeaderPreset);

  const [selectedId, setSelectedId] = useState("");
  // 选中的分组被删掉后自动落到第一个，避免右侧停在空面板上。
  const activeId = presets.some((item) => item.id === selectedId)
    ? selectedId
    : (presets[0]?.id ?? "");
  const preset = presets.find((item) => item.id === activeId) ?? null;

  const [name, setName] = useState("");
  const [headers, setHeaders] = useState<HeaderDraft[]>([]);
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [saving, setSaving] = useState(false);

  // 只在切换分组时灌入草稿：跟随 props 会让打字过程中被 SSE 推来的新配置覆盖掉。
  useEffect(() => {
    setName(preset?.name ?? "");
    setHeaders((preset?.customHeaders ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      value: entry.value,
    })));
    setRules((preset?.headerRules ?? []).map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      namePrefix: rule.namePrefix,
      action: rule.action,
      value: rule.value,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const patchHeader = (id: string, patch: Partial<HeaderDraft>): void =>
    setHeaders((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );

  const patchRule = (id: string, patch: Partial<RuleDraft>): void =>
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );

  const submit = async (): Promise<void> => {
    if (!preset) return;
    setSaving(true);
    try {
      await saveHeaderPreset(preset.id, {
        name: name.trim() || preset.name,
        customHeaders: headers
          .filter((entry) => entry.name.trim().length > 0)
          .map((entry) => ({
            id: entry.id,
            name: entry.name.trim(),
            value: entry.value.trim(),
          })),
        headerRules: rules
          .filter((rule) => rule.namePrefix.trim().length > 0)
          .map((rule) => ({
            id: rule.id,
            enabled: rule.enabled,
            namePrefix: rule.namePrefix.trim(),
            action: rule.action,
            value: rule.action === "set" ? rule.value.trim() : "",
          })),
      });
      // 失败时不关闭：toast 里已带服务端给的具体原因，方便改完再存。
    } finally {
      setSaving(false);
    }
  };

  const usedBy = preset
    ? targets.filter((target) => target.headerPresetIds.includes(preset.id))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
        分组是全局的：在这里定义，在
        <strong className="mx-1 font-medium text-fg">编辑转发地址</strong>
        里勾选生效。可以同时勾选多个，按下方列表顺序叠加，
        <strong className="font-medium text-fg">后面的覆盖前面的</strong>
        ；用箭头调整顺序。
      </p>

      <div className="grid gap-4 panel:grid-cols-[220px_minmax(0,1fr)]">
        <GroupList
          title="请求头分组"
          items={presets.map((item) => ({
            id: item.id,
            name: item.name,
            meta: `${item.customHeaders.length} 固定头 · ${item.headerRules.length} 规则`,
          }))}
          selectedId={activeId}
          onSelect={setSelectedId}
          onCreate={() => {
            void createHeaderPreset(`请求头分组 ${presets.length + 1}`).then((id) => {
              if (id) setSelectedId(id);
            });
          }}
          onDelete={(id) => void removeHeaderPreset(id)}
          onMove={(id, direction) => void moveHeaderPreset(id, direction)}
          emptyHint="还没有请求头分组。新建一个，把常用的鉴权头收进去，再给转发地址勾选。"
        />

        {!preset ? (
          <EmptyState
            title="还没有请求头分组"
            hint="新建分组后可以往里面加固定请求头与匹配规则，再在转发地址上勾选生效。"
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="px-title-eyebrow">分组名称</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如： staging 鉴权"
                aria-label="分组名称"
                className="min-h-9"
              />
              <p className="m-0 text-[11px] leading-relaxed text-fg-dim">
                {usedBy.length > 0
                  ? `已被 ${usedBy.length} 个转发地址引用：${usedBy.map((target) => target.name).join("、")}`
                  : "还没有转发地址引用这个分组。"}
              </p>
            </div>

            <section className="flex flex-col gap-2.5 border-t border-line pt-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="m-0 font-display text-[14px] font-semibold text-fg">固定请求头</h3>
                  <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
                    每个出站请求都会带上，同名时覆盖客户端原值；可以加多条。
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setHeaders((current) => [
                      ...current,
                      { id: draftId(), name: "", value: "" },
                    ])
                  }
                >
                  <Plus className="size-4" />
                  添加请求头
                </Button>
              </div>

              {headers.length === 0 ? (
                <p className="m-0 rounded-md border border-dashed border-line px-3 py-3 text-[12px] text-fg-dim">
                  还没有固定请求头。
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {headers.map((entry) => (
                    <li
                      key={entry.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2"
                    >
                      <Input
                        value={entry.name}
                        onChange={(event) => patchHeader(entry.id, { name: event.target.value })}
                        placeholder="x-tenant-id"
                        aria-label="请求头名称"
                        className="min-h-9 font-mono text-[13px]"
                      />
                      <Input
                        value={entry.value}
                        onChange={(event) => patchHeader(entry.id, { value: event.target.value })}
                        placeholder="值，例如 Bearer xxx"
                        aria-label="请求头值"
                        className="min-h-9 font-mono text-[13px]"
                      />
                      <IconButton
                        label="删除该请求头"
                        tone="danger"
                        className="size-7 [&_svg]:size-3.5"
                        onClick={() =>
                          setHeaders((current) =>
                            current.filter((item) => item.id !== entry.id),
                          )
                        }
                      >
                        <Trash2 />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-2.5 border-t border-line pt-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="m-0 font-display text-[14px] font-semibold text-fg">匹配规则</h3>
                  <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
                    按请求头
                    <strong className="font-semibold">名称前缀</strong>
                    匹配（大小写不敏感，
                    <code className="font-mono">x-</code> 一次命中所有{" "}
                    <code className="font-mono">x-</code> 开头的头），可命中多个头。
                    规则在固定请求头之后执行，所以也能改写上面那些自定义头；多条规则按顺序执行，后面的覆盖前面的。
                    被代理接管的头（
                    <code className="font-mono">host</code>、
                    <code className="font-mono">content-length</code>、
                    <code className="font-mono">accept-encoding</code> 等）不会生效。
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setRules((current) => [
                      ...current,
                      { id: draftId(), enabled: true, namePrefix: "", action: "set", value: "" },
                    ])
                  }
                >
                  <Plus className="size-4" />
                  添加规则
                </Button>
              </div>

              {rules.length === 0 ? (
                <p className="m-0 rounded-md border border-dashed border-line px-3 py-3 text-[12px] text-fg-dim">
                  还没有匹配规则。
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {rules.map((rule) => (
                    <li
                      key={rule.id}
                      className={cn(
                        "flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5",
                        !rule.enabled && "opacity-60",
                      )}
                    >
                      <Toggle
                        checked={rule.enabled}
                        onCheckedChange={(value) => patchRule(rule.id, { enabled: value })}
                        label={`${rule.enabled ? "停用" : "启用"}规则 ${rule.namePrefix || "未命名"}`}
                      />

                      <Input
                        value={rule.namePrefix}
                        onChange={(event) =>
                          patchRule(rule.id, { namePrefix: event.target.value })
                        }
                        placeholder="x-internal-"
                        aria-label="请求头名称前缀"
                        className="min-h-9 w-[130px] font-mono text-[13px]"
                      />

                      <Select
                        label="匹配后的动作"
                        value={rule.action}
                        onChange={(value) => patchRule(rule.id, { action: value })}
                        options={ACTION_OPTIONS}
                        compact
                        className="w-[124px]"
                      />

                      {rule.action === "set" ? (
                        <Input
                          value={rule.value}
                          onChange={(event) => patchRule(rule.id, { value: event.target.value })}
                          placeholder="替换后的值"
                          aria-label="替换后的值"
                          className="min-h-9 min-w-[140px] flex-1 font-mono text-[13px]"
                        />
                      ) : (
                        <span className="min-w-[140px] flex-1 text-[12px] text-fg-dim">
                          命中后不转发该请求头
                        </span>
                      )}

                      <IconButton
                        label="删除该规则"
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
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
              <Button variant="primary" disabled={saving} onClick={() => void submit()}>
                {saving ? "保存中…" : "保存分组"}
              </Button>
            </div>

            <p className="m-0 text-[12px] leading-relaxed text-fg-dim">
              面板里记录的仍然是客户端原始请求头；改了发往上游的内容不会反过来改写历史记录。
              重放请求默认不带这套配置，需要时在重放对话框里勾选「启用自定义请求头」。
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
