import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;

/** 轻量提示：不参与布局（Radix 走 Portal），所以不会像伪元素那样撑出横向滚动。 */
export const Tooltip = ({
  label,
  children,
  side = "top",
  align = "center",
  delay = 320,
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delay?: number;
}) => (
  <TooltipPrimitive.Root delayDuration={delay}>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        align={align}
        sideOffset={8}
        className={cn(
          "z-[2000] max-w-[min(280px,80vw)] rounded-sm border border-line-strong",
          "bg-surface px-2.5 py-1.5 text-[12px] leading-snug text-fg shadow-[var(--px-shadow-pop)]",
          "data-[state=delayed-open]:animate-[px-pop_140ms_ease-out]",
        )}
      >
        {label}
        <TooltipPrimitive.Arrow className="fill-[var(--px-line-strong)]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
);
