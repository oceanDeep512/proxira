import { cn } from "../../lib/cn";

/** 分段控件：用于「同一份数据的不同视图」切换，比下拉更快也更可见。 */
export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  className,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className={cn(
      "inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2 p-0.5",
      className,
    )}
  >
    {options.map((option) => {
      const active = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={active}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex min-h-7 items-center rounded-full px-2.5 text-[12px] font-medium",
            "transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            "pointer-coarse:min-h-9",
            active
              ? "bg-accent text-accent-fg"
              : "text-fg-soft hover:bg-surface-3 hover:text-fg",
          )}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);
