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
      {/* 宽度：flex-1 参与父行的 3:1 分配，上限 max-w-[280px]；
          下限用 min-w-fit —— 最小宽度由「历史请求 + 条数」的固有宽度决定，
          条数变多（23 → 1234）按钮自动变宽，不会写死一个值。
          overflow-hidden 兜底：真被压到比内容还窄时截断而不是把文字顶出去。 */}
      <Button
        size="sm"
        variant="secondary"
        className={cn("min-w-fit overflow-hidden", className)}
        onClick={() => setOpen(true)}
        aria-label="打开历史请求列表"
        title={selected ? `当前：${selected.method} ${selected.path}` : "选择一条历史请求"}
      >
        <History className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">历史请求</span>
        {/* 条数是关键信息，不可被截断，所以 shrink-0。 */}
        <span className="shrink-0 font-mono text-fg-dim">{records.length}</span>
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
