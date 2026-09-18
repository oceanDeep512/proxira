import { useState } from "react";
import { History } from "lucide-react";
import { useProxiraStore } from "../../store/proxira";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { RecordList, RecordListActions } from "./RecordList";
import { cn } from "../../lib/cn";

/**
 * 窄屏（垂直排列）专用：历史请求不再占一整块高度，
 * 而是收成转发地址那一行里的一个按钮，点开对话框再做筛选 / 选择 / 清除 / 导出。
 * 选中一条后自动关闭，把高度全部让给详情。
 *
 * 仅由 TargetHub 在 max-panel（<960px）下挂载显示，宽屏仍是左侧常驻列表。
 */
export const RecordPicker = ({ className }: { className?: string }) => {
  const [open, setOpen] = useState(false);
  const records = useProxiraStore((state) => state.records);
  const recordsTotal = useProxiraStore((state) => state.recordsTotal);
  const selectedRecordId = useProxiraStore((state) => state.selectedRecordId);
  const selected = records.find((record) => record.id === selectedRecordId) ?? records[0] ?? null;

  return (
    <>
      {/* 只给最小宽度：宽度由「历史请求 + 条数」自然撑开，空间紧张时才压缩并截断，
          不写死成固定值，也不再和下拉抢固定份额。 */}
      <Button
        size="sm"
        variant="secondary"
        className={cn("min-w-[96px]", className)}
        onClick={() => setOpen(true)}
        aria-label="打开历史请求列表"
        title={selected ? `当前：${selected.method} ${selected.path}` : "选择一条历史请求"}
      >
        <History className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          历史请求
          <span className="ml-1 font-mono text-fg-dim">{records.length}</span>
        </span>
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="历史请求"
        description="选中一条即可查看详情，筛选与批量操作都在对话框内完成。"
        width="lg"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <span className="font-mono text-[12px] text-fg-dim">
              {records.length} / {recordsTotal}
            </span>
            <div className="flex items-center gap-1.5">
              <RecordListActions />
            </div>
          </div>
        }
      >
        {/* 固定高度 + 内部滚动：对话框自身不撑高，页面也不会被带得可滚。 */}
        <div className="flex h-[min(60dvh,520px)] min-h-0 flex-col">
          <RecordList isWide={false} embedded onPicked={() => setOpen(false)} />
        </div>
      </Modal>
    </>
  );
};
