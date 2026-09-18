import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerSolid";
type Size = "sm" | "md";

const variantClasses: Record<Variant, string> = {
  primary:
    "border border-accent bg-accent text-accent-fg hover:bg-accent-strong hover:border-accent-strong",
  secondary:
    "border border-line bg-surface-2 text-fg hover:border-line-strong hover:bg-surface-3",
  ghost: "border border-transparent bg-transparent text-fg-soft hover:bg-surface-2 hover:text-fg",
  danger: "border border-danger/45 bg-transparent text-danger hover:bg-danger/10",
  dangerSolid: "border border-danger bg-danger text-white hover:brightness-110",
};

const sizeClasses: Record<Size, string> = {
  sm: "min-h-8 px-3 text-[13px]",
  md: "min-h-9 px-4 text-sm",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        // 触摸设备上放大到 44px，桌面保持紧凑的 32/36px。
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium",
        "transition-[background-color,border-color,color,filter] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-55",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "pointer-coarse:min-h-11",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});
