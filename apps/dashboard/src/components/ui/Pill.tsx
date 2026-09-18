import { cn } from "../../lib/cn";

export type Tone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "other";

const toneClasses: Record<Tone, string> = {
  neutral: "border-line bg-surface-2 text-fg-soft",
  accent: "border-accent/45 bg-accent-soft text-accent-strong",
  success: "border-success/45 bg-success/10 text-success",
  warning: "border-warning/45 bg-warning/10 text-warning",
  danger: "border-danger/45 bg-danger/10 text-danger",
  info: "border-info/45 bg-info/10 text-info",
  get: "border-[var(--px-method-get)]/45 bg-[var(--px-method-get)]/10 text-[var(--px-method-get)]",
  post: "border-[var(--px-method-post)]/45 bg-[var(--px-method-post)]/10 text-[var(--px-method-post)]",
  put: "border-[var(--px-method-put)]/45 bg-[var(--px-method-put)]/10 text-[var(--px-method-put)]",
  patch:
    "border-[var(--px-method-patch)]/45 bg-[var(--px-method-patch)]/10 text-[var(--px-method-patch)]",
  delete:
    "border-[var(--px-method-delete)]/45 bg-[var(--px-method-delete)]/10 text-[var(--px-method-delete)]",
  other:
    "border-[var(--px-method-other)]/45 bg-[var(--px-method-other)]/10 text-[var(--px-method-other)]",
};

export const methodTone = (method: string): Tone => {
  switch (method.toUpperCase()) {
    case "GET":
      return "get";
    case "POST":
      return "post";
    case "PUT":
      return "put";
    case "PATCH":
      return "patch";
    case "DELETE":
      return "delete";
    default:
      return "other";
  }
};

export const Pill = ({
  tone = "neutral",
  className,
  children,
  mono = true,
  title,
  /** 传了 onClick 就渲染成按钮（如顶栏「服务在线」= 点击重连）。 */
  onClick,
  label,
  disabled,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
  mono?: boolean;
  title?: string;
  onClick?: () => void;
  label?: string;
  disabled?: boolean;
}) => {
  const classes = cn(
    "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-px",
    "text-[11px] font-semibold tracking-wide",
    mono && "font-mono",
    toneClasses[tone],
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={label ?? title}
        className={cn(
          classes,
          "cursor-pointer transition-[filter,opacity] duration-150",
          "hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        {children}
      </button>
    );
  }

  return (
    <span title={title} className={classes}>
      {children}
    </span>
  );
};
