import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export const EmptyState = ({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
      className,
    )}
  >
    {icon ? <div className="text-fg-dim [&_svg]:size-7">{icon}</div> : null}
    <p className="m-0 font-display text-[15px] font-semibold text-fg">{title}</p>
    {hint ? <p className="m-0 max-w-[46ch] text-[13px] leading-relaxed text-fg-soft">{hint}</p> : null}
    {action ? <div className="mt-1">{action}</div> : null}
  </div>
);
