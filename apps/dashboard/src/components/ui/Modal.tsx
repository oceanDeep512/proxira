import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export const Modal = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
}) => {
  const widthClass = {
    sm: "max-w-[420px]",
    md: "max-w-[560px]",
    lg: "max-w-[760px]",
    xl: "max-w-[960px]",
  }[width];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[1200] bg-[color-mix(in_srgb,var(--px-bg)_72%,transparent)]",
            "backdrop-blur-[3px]",
            "data-[state=open]:animate-[px-pop_160ms_ease-out]",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[1210] flex max-h-[calc(100dvh-32px)] w-[calc(100vw-24px)]",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-lg border border-line bg-surface shadow-[var(--px-shadow-pop)]",
            "data-[state=open]:animate-[px-pop_180ms_cubic-bezier(0.22,1,0.36,1)]",
            widthClass,
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-display text-lg font-semibold text-fg">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-fg-soft">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              aria-label="关闭"
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                "border border-line bg-surface-2 text-fg-soft",
                "transition-colors hover:border-line-strong hover:text-fg",
              )}
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer ? (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
