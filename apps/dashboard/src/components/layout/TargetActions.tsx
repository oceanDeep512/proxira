import { useEffect, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { selectActiveTarget, useProxiraStore } from "../../store/proxira";
import { useUiStore } from "../../store/ui";
import { IconButton } from "../ui/IconButton";
import { cn } from "../../lib/cn";

/**
 * 窄屏（垂直排列）专用：把转发地址那一排功能按钮折成一个「更多」触发器，
 * 点开后在同一行下方浮出按钮组，收起后整块只占一个按钮的宽度。
 *
 * 宽屏仍是平铺的一排按钮（由 TargetHub 渲染），这里整体隐藏。
 *
 * 没有用 Radix DropdownMenu：浮层里放的是普通图标按钮而不是 menuitem，
 * 而且点「新增/删除」会再开一个 Dialog，DropdownMenu 的焦点回收会和 Dialog 抢焦点。
 * 这个浮层只做定位 + 外部点击/Esc 关闭，焦点交给浏览器自然顺序。
 */
export const TargetActions = ({
  onCreate,
  onEdit,
  onDelete,
  onRules,
  className,
}: {
  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRules: () => void;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeTarget = useProxiraStore(selectActiveTarget);
  const showSensitive = useUiStore((state) => state.showSensitive);
  const toggleSensitive = useUiStore((state) => state.toggleSensitive);

  const currentId = activeTarget?.id ?? "";

  // 点外部 / Esc 关闭。停止传播用不到：浮层是 absolute，不参与页面滚动链。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  // 先收起浮层再执行动作，避免浮层盖在随后弹出的对话框上。
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-label={open ? "收起功能菜单" : "展开功能菜单"}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-md border",
          "border-line bg-surface-2 text-fg-soft",
          "transition-[background-color,border-color,color] duration-150",
          "hover:border-line-strong hover:bg-surface-3 hover:text-fg",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "pointer-coarse:size-11",
          "[&_svg]:size-4",
          open && "border-accent/50 bg-accent-soft text-accent",
        )}
      >
        {open ? <X /> : <MoreHorizontal />}
      </button>

      {open ? (
        <div
          role="group"
          aria-label="转发地址功能"
          className={cn(
            "absolute right-0 top-full z-[1300] mt-1.5 flex items-center gap-1",
            "rounded-lg border border-line-strong bg-surface p-1.5",
            "shadow-[var(--px-shadow-pop)]",
            "animate-[px-pop_140ms_ease-out]",
          )}
        >
          <IconButton label="新增转发地址" tone="accent" onClick={run(onCreate)}>
            <Plus />
          </IconButton>
          <IconButton
            label="编辑当前转发地址"
            disabled={!currentId}
            onClick={run(onEdit)}
          >
            <Pencil />
          </IconButton>
          <IconButton
            label="删除当前转发地址"
            tone="danger"
            disabled={!currentId}
            onClick={run(onDelete)}
          >
            <Trash2 />
          </IconButton>

          <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />

          <IconButton label="拦截规则（Mock / 故障注入）" onClick={run(onRules)}>
            <ShieldCheck />
          </IconButton>
          <IconButton
            label={showSensitive ? "隐藏敏感信息" : "显示敏感信息"}
            tone={showSensitive ? "accent" : "default"}
            onClick={run(toggleSensitive)}
          >
            {showSensitive ? <EyeOff /> : <Eye />}
          </IconButton>
        </div>
      ) : null}
    </div>
  );
};
