import { Moon, RefreshCw, RotateCcw, Sun } from "lucide-react";
import { useProxiraStore } from "../../store/proxira";
import { useUiStore } from "../../store/ui";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Pill } from "../ui/Pill";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/cn";

const connectionMeta = {
  open: { label: "服务在线", tone: "success" as const },
  connecting: { label: "服务连接中", tone: "warning" as const },
  closed: { label: "服务离线", tone: "danger" as const },
};

export const TopBar = ({
  onReset,
  resetting,
}: {
  onReset: () => void;
  resetting: boolean;
}) => {
  const connectionState = useProxiraStore((state) => state.connectionState);
  const connectSse = useProxiraStore((state) => state.connectSse);
  const recordsTotal = useProxiraStore((state) => state.recordsTotal);
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);

  const meta = connectionMeta[connectionState];

  return (
    <header
      className={cn(
        "px-card flex min-w-[260px] flex-1 flex-wrap items-center justify-between gap-3",
        "px-4 py-3",
        "panel:w-full panel:grow-0 panel:shrink-0 panel:basis-auto",
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
        <Pill tone={meta.tone} className="gap-1.5 py-1">
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

        <Pill tone="neutral" className="py-1">
          {recordsTotal} 条
        </Pill>

        <div className="flex items-center gap-1.5">
          <Tooltip label="重新建立 SSE 连接">
            <IconButton label="重新连接" onClick={connectSse}>
              <RefreshCw />
            </IconButton>
          </Tooltip>

          <Tooltip label={theme === "dark" ? "切换到浅色" : "切换到深色"}>
            <IconButton
              label={theme === "dark" ? "切换到浅色" : "切换到深色"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </IconButton>
          </Tooltip>

          <Tooltip label="清空全部转发地址与历史记录">
            <Button variant="danger" size="sm" onClick={onReset} disabled={resetting}>
              <RotateCcw className="size-3.5" />
              {resetting ? "重置中" : "重置"}
            </Button>
          </Tooltip>
        </div>
      </div>
    </header>
  );
};
