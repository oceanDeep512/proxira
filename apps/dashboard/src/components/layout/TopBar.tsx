import { Settings } from "lucide-react";
import { useProxiraStore } from "../../store/proxira";
import { Pill } from "../ui/Pill";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/cn";

const connectionMeta = {
  open: { label: "服务在线", tone: "success" as const },
  connecting: { label: "服务连接中", tone: "warning" as const },
  closed: { label: "服务离线", tone: "danger" as const },
};

export const TopBar = ({
  onOpenSettings,
  className,
}: {
  /** 打开设置面板。主题切换与重置已收入设置通用标签。 */
  onOpenSettings: () => void;
  className?: string;
}) => {
  const connectionState = useProxiraStore((state) => state.connectionState);
  const connectSse = useProxiraStore((state) => state.connectSse);

  const meta = connectionMeta[connectionState];

  return (
    <header
      className={cn(
        // 顶栏永远不参与伸缩：外层是纵向 flex 列，带 flex-1 会被垂直拉满。
        "px-panel flex min-w-0 shrink-0 grow-0 basis-auto flex-wrap items-center justify-between gap-3",
        "border-b border-line px-4 py-2.5",
        "panel:w-full",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <img
          src={`${import.meta.env.BASE_URL}proxira-logo.svg`}
          alt="Proxira"
          className="h-11 w-11 shrink-0 select-none object-cover object-left"
        />
        <div className="min-w-0">
          <h1 className="truncate font-display text-[22px] font-semibold leading-none tracking-tight">
            Proxira
          </h1>
          <p className="px-title-eyebrow mt-1">请求观测面板</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* 状态本身就是重连入口：点一下重新建立 SSE，省掉一个专用按钮 */}
        <Pill
          tone={meta.tone}
          className="gap-1.5 py-1"
          onClick={connectSse}
          disabled={connectionState === "connecting"}
          title={
            connectionState === "connecting" ? "正在重连…" : "重新建立连接（点击手动重连）"
          }
          label="重新建立连接"
        >
          <span className="relative flex size-1.5">
            <span
              className={cn(
                "absolute inset-0 rounded-full bg-current",
                connectionState === "open" && "animate-ping opacity-70",
              )}
            />
            <span className="relative size-1.5 rounded-full bg-current" />
          </span>
          {meta.label}
        </Pill>

        <Tooltip label="设置">
          <IconButton label="设置" onClick={onOpenSettings}>
            <Settings className="size-4" />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
};
