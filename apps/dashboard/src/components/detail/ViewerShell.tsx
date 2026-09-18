import type { ReactNode, RefObject } from "react";
import { cn } from "../../lib/cn";

/**
 * 「代码阅读框」外壳：树形 / 原始 / 表格 / 事件流统一用它，
 * 保证切换视图时边框、圆角、顶部菜单条完全一致（不会跳布局），
 * 复制、下载这类操作也统一收进顶部菜单，而不是浮在标题行里。
 */

export const ViewerFrame = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("overflow-hidden rounded-md border border-line bg-surface-2", className)}>
    {children}
  </div>
);

export const ViewerToolbar = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-wrap items-center gap-1 border-b border-line bg-surface-3/50 px-2 py-1",
      className,
    )}
  >
    {children}
  </div>
);

export const ToolbarButton = ({
  icon,
  label,
  onClick,
  active = false,
  className,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      "inline-flex min-h-6 items-center gap-1 rounded-sm px-1.5 text-[11px]",
      "transition-colors hover:bg-surface-3 hover:text-fg",
      // 菜单按钮本身很小，键盘焦点必须画出来，否则 Tab 过去完全没反馈。
      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
      // 触摸设备上放大到 36px，避免密集菜单变成误触陷阱。
      "pointer-coarse:min-h-9 pointer-coarse:px-2",
      active ? "text-accent-strong" : "text-fg-dim",
      className,
    )}
  >
    {icon}
    {label}
  </button>
);

/** 工具栏右侧的对齐组（命中计数、无匹配提示等）。 */
export const ToolbarGroup = ({ children }: { children: ReactNode }) => (
  <div className="ml-auto flex items-center gap-1">{children}</div>
);

export const ViewerBody = ({
  children,
  maxHeight = 560,
  className,
  scrollRef,
}: {
  children: ReactNode;
  maxHeight?: number;
  className?: string;
  /** 需要滚动到指定元素的调用方（源码视图定位搜索命中）自己拿这个 ref。 */
  scrollRef?: RefObject<HTMLDivElement | null>;
}) => (
  <div ref={scrollRef} className={cn("overflow-auto py-1", className)} style={{ maxHeight }}>
    {children}
  </div>
);
