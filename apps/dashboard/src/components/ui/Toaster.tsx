import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore, type ToastLevel } from "../../store/toast";
import { cn } from "../../lib/cn";

const iconByLevel: Record<ToastLevel, typeof Info> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const toneByLevel: Record<ToastLevel, string> = {
  success: "border-success/50",
  error: "border-danger/50",
  info: "border-line-strong",
};

const iconToneByLevel: Record<ToastLevel, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-info",
};

export const Toaster = () => {
  const messages = useToastStore((state) => state.messages);
  const dismiss = useToastStore((state) => state.dismiss);

  if (messages.length === 0) return null;

  return (
    <ol
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed bottom-4 right-4 z-[2000] flex w-[min(360px,calc(100vw-24px))]",
        "flex-col gap-2 m-0 list-none p-0",
      )}
    >
      {messages.map((message) => {
        const Icon = iconByLevel[message.level];
        return (
          <li
            key={message.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-md border bg-surface px-3 py-2.5",
              "shadow-[var(--px-shadow-pop)]",
              "animate-[px-fade-up_180ms_cubic-bezier(0.22,1,0.36,1)]",
              toneByLevel[message.level],
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", iconToneByLevel[message.level])} />
            <p className="m-0 min-w-0 flex-1 break-words text-[13px] leading-snug">{message.text}</p>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => dismiss(message.id)}
              className="shrink-0 rounded-sm p-0.5 text-fg-dim transition-colors hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ol>
  );
};
