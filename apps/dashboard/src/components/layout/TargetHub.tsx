import { Eye, EyeOff, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { selectActiveTarget, useProxiraStore } from "../../store/proxira";
import { useUiStore } from "../../store/ui";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { RecordPicker } from "../records/RecordPicker";
import { TargetActions } from "./TargetActions";
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
        // 双栏下与右侧「详情标题栏(88) + 分区 tab 栏(45)」等高，两条分隔线对齐。
        // 只设 min-h：内容真变高时照常增高，不会被裁。
        "panel:min-h-[133px]",
      )}
    >
      {/* 标题字号与「历史请求」等面板标题一致（font-display 15px semibold）。
          窄屏整行隐藏：标题、超时都由浮层/下拉自解释，把高度让给内容。 */}
      <div className="flex items-center justify-between gap-2 max-panel:hidden">
        <h2 className="font-display text-[15px] font-semibold">转发地址</h2>
        {activeTarget?.upstreamTimeoutMs ? (
          <span className="font-mono text-[11px] text-fg-dim">
            超时 {activeTarget.upstreamTimeoutMs} ms
          </span>
        ) : null}
      </div>

      {/* 这一行承担全部宽度分配，宽度不够时靠 flex-wrap 把功能按钮排挤到下一行：
          - 下拉 flex-[3] / 历史请求 flex-1：剩余宽度按 3:1 分，不再让下拉独占
            （900px 时约 500 : 168，此前是 769 : 118）
          - 下拉 min-w-[160px] 是换行阈值：宽屏左栏只有 ~282px，
            下拉 + 功能排放不进去 → 功能排自动换到下一行，还原成宽屏的两行布局；
            同时它要保证 360px 下「下拉 + 历史请求 + 折叠按钮」仍能挤在一行
          - 历史请求 min-w-fit / max-w 280：下限跟着文字走，上限不让它膨胀成空按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[160px] flex-[3]">
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

        {/* 只在堆叠布局（<960）出现：宽屏历史列表常驻在左栏。 */}
        <RecordPicker className="panel:hidden max-w-[280px] flex-1" />

        {/* ≥700px：功能按钮平铺（跟下拉同一行，或换行到下方）。 */}
        <div className="hidden shrink-0 items-center gap-1.5 hub:flex">
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

        {/* <700px：折成一个「更多」按钮，点开浮出同一组功能。 */}
        <TargetActions
          className="panel:hidden hub:hidden"
          onCreate={onCreate}
          onEdit={onEdit}
          onDelete={onDelete}
          onRules={onRules}
        />
      </div>
    </section>
  );
};
