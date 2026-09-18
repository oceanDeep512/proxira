import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export const Field = ({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) => (
  <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
    <span className="px-title-eyebrow">{label}</span>
    {children}
    {hint ? <span className="text-[11px] leading-snug text-fg-dim">{hint}</span> : null}
  </label>
);

const controlBase = cn(
  "w-full rounded-md border border-line bg-surface-2 px-3 text-[14px] text-fg",
  "placeholder:text-fg-dim transition-colors",
  "hover:border-line-strong",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft",
  "disabled:opacity-60",
);

export const Input = ({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(controlBase, "min-h-10", className)} {...props} />
);

export const Textarea = ({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    className={cn(controlBase, "min-h-24 resize-y py-2 font-mono text-[13px] leading-relaxed", className)}
    {...props}
  />
);
