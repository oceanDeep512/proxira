import { Eye, EyeOff, Pencil, Plus, ShieldCheck, Tags, Trash2 } from "lucide-react";
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
  onHeaders,
}: {
  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRules: () => void;
  onHeaders: () => void;
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
        // 双栏下与右侧「详情标题栏(57) + 分区 tab 栏(45)」等高，两条分隔线对齐。
        // 只设 min-h：内容真变高时照常增高，不会被裁。
        "panel:min-h-[102px]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* 标题与下拉同一行：原来标题单独占一行，左列比右列多出 28px 对不齐。
            超时改成短格式（30s 而不是 30000 ms），否则这一行塞不下会把下拉挤走。
            窄屏两者都隐藏，下拉独占整行。 */}
        <h2 className="shrink-0 font-display text-[15px] font-semibold max-panel:hidden">
          转发地址
        </h2>
        {activeTarget?.upstreamTimeoutMs ? (
          <span
            className="shrink-0 font-mono text-[11px] text-fg-dim max-panel:hidden"
            title={`上游超时 ${activeTarget.upstreamTimeoutMs} ms`}
          >
            {activeTarget.upstreamTimeoutMs >= 1000
              ? `${activeTarget.upstreamTimeoutMs / 1000}s`
              : `${activeTarget.upstreamTimeoutMs}ms`}
          </span>
        ) : null}

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
          <Tooltip label="请求头（固定头 / 改写规则）">
            <IconButton label="请求头" onClick={onHeaders}>
              <Tags />
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
          onHeaders={onHeaders}
        />
      </div>
    </section>
  );
};
