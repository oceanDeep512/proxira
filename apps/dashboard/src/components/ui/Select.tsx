import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
};

/** 基于 Radix 的下拉选择：键盘可达、窄屏内容可滚动，替代原生 select 的样式失控。 */
export const Select = <T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  align = "start",
  compact = false,
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
  align?: "start" | "center" | "end";
  compact?: boolean;
}) => {
  const current = options.find((option) => option.value === value);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        className={cn(
          "inline-flex min-h-8 w-full items-center justify-between gap-2 rounded-md border",
          "border-line bg-surface-2 px-2.5 text-[13px] text-fg transition-colors",
          "hover:border-line-strong hover:bg-surface-3",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "pointer-coarse:min-h-11",
          compact && "min-h-7 px-2 text-[12px]",
          className,
        )}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0 fill-fg-dim">
          <path d="M2 4.2 6 8.4l4-4.2H2Z" />
        </svg>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className={cn(
            "z-[1500] max-h-[min(320px,60dvh)] min-w-[var(--radix-dropdown-menu-trigger-width)]",
            "overflow-y-auto rounded-md border border-line-strong bg-surface p-1",
            "shadow-[var(--px-shadow-pop)]",
          )}
        >
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.value}
              onSelect={() => onChange(option.value)}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none",
                "data-[highlighted]:bg-accent-soft data-[highlighted]:text-fg",
              )}
            >
              <Check
                className={cn(
                  "mt-0.5 size-3.5 shrink-0 text-accent",
                  option.value === value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.hint ? (
                  <span className="block truncate text-[11px] text-fg-dim">{option.hint}</span>
                ) : null}
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
