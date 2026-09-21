import { useEffect, useState } from "react";
import { Field, Input } from "../ui/Field";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { cn } from "../../lib/cn";

export type TargetFormValue = {
  name: string;
  targetBaseUrl: string;
  upstreamTimeoutMs: number | null;
  headerPresetIds: string[];
  mockGroupIds: string[];
};

export type GroupOption = {
  id: string;
  name: string;
  /** 括号里的补充信息，例如「3 固定头 · 1 规则」。 */
  meta?: string;
};

/**
 * 勾选列表：可多选，勾选顺序 = 列表顺序（不是点击顺序）。
 *
 * 顺序在这里是有语义的：请求头分组靠后的覆盖靠前的，Mock 分组靠前的先匹配。
 * 用「列表顺序」而不是「点击顺序」，是因为前者在界面上可见（第 1 个永远在最上面），
 * 后者只能靠一个额外的序号列才看得出来。要调顺序就回设置里用箭头调。
 */
const GroupCheckList = ({
  options,
  selectedIds,
  onToggle,
  emptyHint,
}: {
  options: GroupOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  emptyHint: string;
}) => {
  if (options.length === 0) {
    return (
      <p className="m-0 rounded-md border border-dashed border-line px-3 py-2.5 text-[12px] leading-relaxed text-fg-dim">
        {emptyHint}
      </p>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {options.map((option) => {
        const checked = selectedIds.includes(option.id);
        return (
          <li key={option.id}>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 transition-colors",
                checked
                  ? "border-accent/45 bg-accent-soft"
                  : "border-line bg-surface-2 hover:border-line-strong",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option.id)}
                className="size-4 shrink-0 accent-[var(--px-accent)]"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium text-fg">{option.name}</span>
                {option.meta ? (
                  <span className="truncate text-[11px] text-fg-dim">{option.meta}</span>
                ) : null}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
};

export const TargetFormModal = ({
  open,
  onOpenChange,
  mode,
  initialValue,
  headerPresetOptions,
  mockGroupOptions,
  loading,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialValue: TargetFormValue;
  /** 全局请求头分组（设置里维护）。 */
  headerPresetOptions: GroupOption[];
  /** 全局 Mock 拦截分组（设置里维护）。 */
  mockGroupOptions: GroupOption[];
  loading: boolean;
  onSubmit: (value: TargetFormValue) => void;
}) => {
  const [name, setName] = useState(initialValue.name);
  const [url, setUrl] = useState(initialValue.targetBaseUrl);
  const [timeoutMs, setTimeoutMs] = useState(
    initialValue.upstreamTimeoutMs === null ? "" : String(initialValue.upstreamTimeoutMs),
  );
  const [headerPresetIds, setHeaderPresetIds] = useState<string[]>(initialValue.headerPresetIds);
  const [mockGroupIds, setMockGroupIds] = useState<string[]>(initialValue.mockGroupIds);

  // 每次打开都从最新的转发地址重新填充，避免上一次的输入残留。
  useEffect(() => {
    if (!open) return;
    setName(initialValue.name);
    setUrl(initialValue.targetBaseUrl);
    setTimeoutMs(
      initialValue.upstreamTimeoutMs === null ? "" : String(initialValue.upstreamTimeoutMs),
    );
    setHeaderPresetIds(initialValue.headerPresetIds);
    setMockGroupIds(initialValue.mockGroupIds);
  }, [open, initialValue]);

  const parsedTimeout = timeoutMs.trim() === "" ? null : Number(timeoutMs);
  const timeoutInvalid =
    parsedTimeout !== null && (!Number.isFinite(parsedTimeout) || parsedTimeout < 0);

  const toggleId = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "create" ? "新增转发地址" : "编辑当前转发地址"}
      description={
        mode === "create"
          ? "创建后不会自动切换，当前请求仍走现有地址，需要时再到顶部下拉里切换。"
          : "修改当前转发地址的名称与地址，地址仍需保持唯一。"
      }
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={loading || !name.trim() || !url.trim() || timeoutInvalid}
            onClick={() =>
              onSubmit({
                name,
                targetBaseUrl: url,
                upstreamTimeoutMs: timeoutInvalid ? null : parsedTimeout,
                headerPresetIds,
                mockGroupIds,
              })
            }
          >
            {loading ? "保存中…" : mode === "create" ? "创建" : "保存"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="名称">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：本地服务"
            autoFocus
          />
        </Field>

        <Field label="转发地址" hint="必须是 http/https 开头的完整地址">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://api.example.com"
            inputMode="url"
          />
        </Field>

        <Field label="上游超时（毫秒）" hint="留空表示使用全局默认超时">
          <Input
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
            placeholder="例如：15000"
            inputMode="numeric"
          />
        </Field>

        {timeoutInvalid ? (
          <p className="m-0 text-[12px] text-danger">超时必须是非负数字。</p>
        ) : null}

        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <span className="px-title-eyebrow">生效的请求头分组</span>
          <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
            可多选，按设置里的列表顺序叠加，<strong className="font-medium text-fg">后面的覆盖前面的</strong>。
            分组内容在设置的「请求头」里维护。
          </p>
          <GroupCheckList
            options={headerPresetOptions}
            selectedIds={headerPresetIds}
            onToggle={(id) => setHeaderPresetIds((current) => toggleId(current, id))}
            emptyHint="还没有请求头分组。在设置 → 请求头里新建后即可在这里勾选。"
          />
        </div>

        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <span className="px-title-eyebrow">生效的 Mock 拦截分组</span>
          <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
            可多选，按顺序匹配，<strong className="font-medium text-fg">第一条命中的规则直接返回</strong>
            ，请求不会打到上游。
          </p>
          <GroupCheckList
            options={mockGroupOptions}
            selectedIds={mockGroupIds}
            onToggle={(id) => setMockGroupIds((current) => toggleId(current, id))}
            emptyHint="还没有 Mock 分组。在设置 → Mock 拦截里新建后即可在这里勾选。"
          />
        </div>
      </div>
    </Modal>
  );
};
