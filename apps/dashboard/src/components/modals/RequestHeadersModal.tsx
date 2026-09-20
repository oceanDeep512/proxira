import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  ProxyHeaderEntry,
  ProxyHeaderRule,
  ProxyHeaderRuleAction,
} from "@proxira/core";
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { Select, type SelectOption } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
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

const toHeaderDraft = (entry: ProxyHeaderEntry): HeaderDraft => ({
  id: entry.id,
  name: entry.name,
  value: entry.value,
});

const toRuleDraft = (rule: ProxyHeaderRule): RuleDraft => ({
  id: rule.id,
  enabled: rule.enabled,
  namePrefix: rule.namePrefix,
  action: rule.action,
  value: rule.value,
});

/**
 * 转发地址级请求头配置：固定头 + 按名称前缀匹配的改写规则。
 *
 * 校验以服务端为准（非法名称、被代理接管的头都会 400 并带上具体原因），
 * 这里只挡掉整行空白这种「显然后台也存不下」的输入。
 */
export const RequestHeadersModal = ({
  open,
  onOpenChange,
  targetName,
  targetId,
  customHeaders,
  headerRules,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetName: string;
  targetId: string;
  customHeaders: ProxyHeaderEntry[];
  headerRules: ProxyHeaderRule[];
  onSubmit: (payload: {
    customHeaders: ProxyHeaderEntry[];
    headerRules: ProxyHeaderRule[];
  }) => Promise<boolean>;
}) => {
  const [headers, setHeaders] = useState<HeaderDraft[]>([]);
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [saving, setSaving] = useState(false);

  // 只在打开或切换转发地址时灌入草稿：跟随 props 会让打字过程中被 SSE 推来的
  // 新配置覆盖掉。
  useEffect(() => {
    if (!open) return;
    setHeaders(customHeaders.map(toHeaderDraft));
    setRules(headerRules.map(toRuleDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetId]);

  const patchHeader = (id: string, patch: Partial<HeaderDraft>): void =>
    setHeaders((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );

  const patchRule = (id: string, patch: Partial<RuleDraft>): void =>
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );

  const submit = async (): Promise<void> => {
    setSaving(true);
    try {
      const ok = await onSubmit({
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
      // 失败时不关窗：toast 里已经带了服务端给的具体原因，方便改完再存。
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="请求头"
      description={
        targetName
          ? `只作用于转发地址「${targetName}」的出站请求，切到其他地址就换一套。`
          : "只作用于当前转发地址的出站请求。"
      }
      width="xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void submit()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="m-0 font-display text-[14px] font-semibold text-fg">
                固定请求头
              </h3>
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
                      setHeaders((current) => current.filter((item) => item.id !== entry.id))
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
              <h3 className="m-0 font-display text-[14px] font-semibold text-fg">
                匹配规则
              </h3>
              <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
                按请求头<strong className="font-semibold">名称前缀</strong>匹配（大小写不敏感，
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
                    className="min-h-9 w-[150px] font-mono text-[13px]"
                  />

                  <Select
                    label="匹配后的动作"
                    value={rule.action}
                    onChange={(value) => patchRule(rule.id, { action: value })}
                    options={ACTION_OPTIONS}
                    compact
                    className="w-[130px]"
                  />

                  {rule.action === "set" ? (
                    <Input
                      value={rule.value}
                      onChange={(event) => patchRule(rule.id, { value: event.target.value })}
                      placeholder="替换后的值"
                      aria-label="替换后的值"
                      className="min-h-9 min-w-[160px] flex-1 font-mono text-[13px]"
                    />
                  ) : (
                    <span className="min-w-[160px] flex-1 text-[12px] text-fg-dim">
                      命中后不转发该请求头
                    </span>
                  )}

                  <IconButton
                    label="删除该规则"
                    tone="danger"
                    className="size-7 [&_svg]:size-3.5"
                    onClick={() =>
                      setRules((current) => current.filter((item) => item.id !== rule.id))
                    }
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="m-0 text-[12px] leading-relaxed text-fg-dim">
          面板里记录的仍然是客户端原始请求头；改了发往上游的内容不会反过来改写历史记录。
          重放请求默认不带这套配置，需要时在重放对话框里勾选「启用自定义请求头」。
        </p>
      </div>
    </Modal>
  );
};
