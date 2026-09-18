import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

export const Toggle = ({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) => (
  <SwitchPrimitive.Root
    checked={checked}
    onCheckedChange={onCheckedChange}
    disabled={disabled}
    aria-label={label}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line",
      "bg-surface-3 transition-colors duration-150 disabled:opacity-50",
      "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    )}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "block size-3.5 translate-x-0.5 rounded-full bg-fg-soft transition-transform duration-150",
        "data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-fg",
      )}
    />
  </SwitchPrimitive.Root>
);
