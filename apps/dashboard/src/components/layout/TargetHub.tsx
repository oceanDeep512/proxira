import { Eye, EyeOff, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { selectActiveTarget, useProxiraStore } from "../../store/proxira";
import { useUiStore } from "../../store/ui";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { RecordPicker } from "../records/RecordPicker";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/cn";

export const TargetHub = ({
  onCreate,
  onEdit,
  onDelete,
  onRules,
}: {
  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRules: () => void;
}) => {
  const targets = useProxiraStore((state) => state.targets);
  const activeTarget = useProxiraStore(selectActiveTarget);
  const switchActiveTarget = useProxiraStore((state) => state.switchActiveTarget);
  const showSensitive = useUiStore((state) => state.showSensitive);
  const toggleSensitive = useUiStore((state) => state.toggleSensitive);

  const currentId = activeTarget?.id ?? "";

  return (
    <section
      className={cn(
        // 同上：高度固定、不伸缩，否则纵向布局里会被拉伸。
        "px-panel flex min-w-0 shrink-0 grow-0 basis-auto flex-col gap-2.5 border-b border-line px-3 py-2.5",
        "panel:w-full",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="px-title-eyebrow">转发地址</span>
        {activeTarget?.upstreamTimeoutMs ? (
          <span className="font-mono text-[11px] text-fg-dim">
            超时 {activeTarget.upstreamTimeoutMs} ms
          </span>
        ) : null}
      </div>

      {/* 窄屏把「历史请求」收进这一行：下拉占剩余宽度，选择器按钮贴右边，
          省掉下面那一整块列表高度。宽屏下按钮隐藏，列表仍在左栏常驻。 */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select
            label="选择转发地址"
            value={currentId}
            onChange={(next) => void switchActiveTarget(next)}
            options={targets.map((target) => ({
              value: target.id,
              label: target.name,
              hint: target.targetBaseUrl,
            }))}
          />
        </div>
        <RecordPicker className="max-panel:inline-flex panel:hidden" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip label="新增转发地址">
          <IconButton label="新增转发地址" onClick={onCreate} tone="accent">
            <Plus />
          </IconButton>
        </Tooltip>
        <Tooltip label="编辑当前转发地址">
          <IconButton label="编辑当前转发地址" onClick={onEdit} disabled={!currentId}>
            <Pencil />
          </IconButton>
        </Tooltip>
        <Tooltip label="删除当前转发地址">
          <IconButton
            label="删除当前转发地址"
            onClick={onDelete}
            disabled={!currentId}
            tone="danger"
          >
            <Trash2 />
          </IconButton>
        </Tooltip>

        <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />

        <Tooltip label="拦截规则（Mock / 故障注入）">
          <IconButton label="拦截规则" onClick={onRules}>
            <ShieldCheck />
          </IconButton>
        </Tooltip>
        <Tooltip label={showSensitive ? "当前：明文显示敏感信息" : "当前：敏感信息已脱敏"}>
          <IconButton
            label={showSensitive ? "隐藏敏感信息" : "显示敏感信息"}
            onClick={toggleSensitive}
            tone={showSensitive ? "accent" : "default"}
          >
            {showSensitive ? <EyeOff /> : <Eye />}
          </IconButton>
        </Tooltip>
      </div>
    </section>
  );
};
