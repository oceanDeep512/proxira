import { AlertTriangle } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  message,
  tips = [],
  confirmText = "确认",
  cancelText = "取消",
  loading,
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  tips?: string[];
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  danger?: boolean;
  onConfirm: () => void;
}) => (
  <Modal
    open={open}
    onOpenChange={onOpenChange}
    title={title}
    width="sm"
    footer={
      <>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
          {cancelText}
        </Button>
        <Button
          variant={danger ? "dangerSolid" : "primary"}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? "处理中…" : confirmText}
        </Button>
      </>
    }
  >
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        {danger ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
        ) : null}
        <p className="m-0 text-[14px] leading-relaxed text-fg">{message}</p>
      </div>

      {tips.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {tips.map((tip) => (
            <li
              key={tip}
              className="flex items-start gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[13px] leading-snug text-fg-soft"
            >
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-fg-dim" />
              {tip}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  </Modal>
);
