import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 无障碍必填：图标按钮没有可见文字。 */
  label: string;
  tooltip?: string;
  tone?: "default" | "danger" | "accent";
  children: ReactNode;
};

const toneClasses = {
  default: "border-line bg-surface-2 text-fg-soft hover:border-line-strong hover:text-fg hover:bg-surface-3",
  danger: "border-line bg-surface-2 text-fg-soft hover:border-danger/60 hover:text-danger hover:bg-danger/10",
  accent: "border-accent/50 bg-accent-soft text-accent hover:border-accent hover:text-accent-strong",
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = "default", className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border",
        "transition-[background-color,border-color,color,transform] duration-150",
        "hover:-translate-y-px active:translate-y-0",
        "disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "pointer-coarse:size-11",
        "[&_svg]:size-4",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
