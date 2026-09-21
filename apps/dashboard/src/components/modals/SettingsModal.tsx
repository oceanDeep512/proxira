import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FolderOpen, Moon, Settings as SettingsIcon, Sun, Tags, X, Zap } from "lucide-react";
import { useProxiraStore } from "../../store/proxira";
import { useUiStore } from "../../store/ui";
import { Button } from "../ui/Button";
import { Toggle } from "../ui/Toggle";
import { HeaderPresetEditor } from "../settings/HeaderPresetEditor";
import { MockGroupEditor } from "../settings/MockGroupEditor";
import { cn } from "../../lib/cn";

type Tab = "general" | "headers" | "mock";

const TABS: { id: Tab; label: string; icon: typeof SettingsIcon; hint: string }[] = [
  { id: "general", label: "通用", icon: SettingsIcon, hint: "数据目录 · 主题 · 重置" },
  { id: "headers", label: "请求头", icon: Tags, hint: "分组 · 固定头 · 匹配规则" },
  { id: "mock", label: "Mock 拦截", icon: Zap, hint: "分组 · 接口规则" },
];

/**
 * 设置面板。左侧竖排标签 + 右侧内容区。
 *
 * 「请求头」与「Mock 拦截」都是**分组**模型：分组是全局的，内含多条规则，
 * 在「编辑转发地址」里勾选生效（可多选、按列表顺序生效）。设置里只负责定义
 * 分组内容，不再按转发地址各存一份。
 *
 * 高度固定、内容区滚动：切标签时对话框不再忽高忽矮。
 *
 * 不复用通用 Modal：那个是 header + 单栏 body + footer 的结构，塞不下左侧标签导航。
 * 这里直接用 Radix DialogPrimitive 拼一个左右分栏的壳，样式与 Modal 保持一致。
 */
export const SettingsModal = ({
  open,
  onOpenChange,
  onOpenFaultRules,
  onRequestReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 打开故障注入规则弹窗（延迟 / 错误 / 断流 / 截断），仍按转发地址配置。 */
  onOpenFaultRules: () => void;
  /** 触发重置确认流程（由 App 持有 ConfirmDialog）。 */
  onRequestReset: () => void;
}) => {
  const [tab, setTab] = useState<Tab>("general");

  const serverStatus = useProxiraStore((state) => state.serverStatus);
  const fetchingStatus = useProxiraStore((state) => state.fetchingStatus);
  const fetchServerStatus = useProxiraStore((state) => state.fetchServerStatus);
  const openDataFolder = useProxiraStore((state) => state.openDataFolder);
  const resettingAll = useProxiraStore((state) => state.resettingAll);

  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);

  // 打开时拉一次服务状态（拿 dataDir）；切回通用标签时若没拉过也补一次。
  useEffect(() => {
    if (open && !serverStatus && !fetchingStatus) {
      void fetchServerStatus();
    }
  }, [open, serverStatus, fetchingStatus, fetchServerStatus]);

  const dataDir = serverStatus?.dataDir ?? "—";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[1200] bg-[color-mix(in_srgb,var(--px-bg)_72%,transparent)]",
            "backdrop-blur-[3px]",
            "data-[state=open]:animate-[px-pop_160ms_ease-out]",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            // 固定高度：切标签时对话框不再忽高忽矮，多出来的内容在右栏里滚。
            // 宽度 1080 是给「分组列表 + 编辑器」两栏留的：两栏加起来才放得下
            // 请求头那几行输入（名称 / 值 / 删除）。
            "fixed left-1/2 top-1/2 z-[1210] flex h-[min(660px,calc(100dvh-40px))] w-[calc(100vw-24px)]",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-lg border border-line bg-surface shadow-[var(--px-shadow-pop)]",
            "data-[state=open]:animate-[px-pop_180ms_cubic-bezier(0.22,1,0.36,1)]",
            "max-w-[1080px]",
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-display text-lg font-semibold text-fg">
                设置
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-fg-soft">
                数据目录、外观与高级配置集中在此。
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="关闭"
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                "border border-line bg-surface-2 text-fg-soft",
                "transition-colors hover:border-line-strong hover:text-fg",
              )}
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          {/* 宽屏：左侧竖排标签（带副标题）；窄屏：顶部横排，只留图标 + 名称。
              窄屏若仍占 160px 左栏，右侧编辑器会被挤扁。 */}
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] panel:grid-cols-[168px_minmax(0,1fr)] panel:grid-rows-1">
            {/* 标签导航 */}
            <nav className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface-2 p-2 panel:flex-col panel:items-stretch panel:overflow-x-visible panel:border-b-0 panel:border-r">
              {TABS.map((item) => {
                const Icon = item.icon;
                const activeTab = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    aria-current={activeTab}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left transition-colors",
                      "panel:flex-col panel:items-start panel:gap-0.5",
                      activeTab
                        ? "bg-surface text-fg shadow-[var(--px-shadow-soft)]"
                        : "text-fg-soft hover:bg-surface hover:text-fg",
                    )}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-medium whitespace-nowrap">
                      <Icon className="size-3.5" />
                      {item.label}
                    </span>
                    <span className="hidden text-[11px] leading-tight text-fg-dim panel:block">
                      {item.hint}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* 右侧内容区 */}
            <div className="min-h-0 overflow-y-auto px-5 py-4">
              {tab === "general" ? (
                <div className="flex flex-col gap-5">
                  <section className="flex flex-col gap-2.5">
                    <h3 className="m-0 font-display text-[14px] font-semibold text-fg">
                      数据存储文件夹
                    </h3>
                    <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
                      历史记录、转发地址、请求头与 Mock 分组配置都写在这个目录里。
                    </p>
                    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                      <code className="m-0 min-w-0 flex-1 truncate font-mono text-[12px] text-fg">
                        {dataDir}
                      </code>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void openDataFolder()}
                        disabled={fetchingStatus}
                      >
                        <FolderOpen className="size-3.5" />
                        打开
                      </Button>
                    </div>
                  </section>

                  <section className="flex items-center justify-between gap-3 border-t border-line pt-4">
                    <div className="min-w-0">
                      <h3 className="m-0 font-display text-[14px] font-semibold text-fg">主题</h3>
                      <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
                        切换浅色与深色外观。
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {theme === "dark" ? <Moon className="size-4 text-fg-soft" /> : <Sun className="size-4 text-fg-soft" />}
                      <Toggle
                        checked={theme === "dark"}
                        onCheckedChange={() => toggleTheme()}
                        label="切换深色主题"
                      />
                    </div>
                  </section>

                  <section className="flex flex-col gap-2.5 border-t border-line pt-4">
                    <h3 className="m-0 font-display text-[14px] font-semibold text-danger">
                      危险区
                    </h3>
                    <p className="m-0 text-[12px] leading-relaxed text-fg-soft">
                      重置将删除全部转发地址、历史记录、请求头与 Mock 分组，仅保留一个默认转发地址。不可撤销。
                    </p>
                    <div>
                      <Button variant="danger" onClick={onRequestReset} disabled={resettingAll}>
                        清空所有数据
                      </Button>
                    </div>
                  </section>
                </div>
              ) : null}

              {tab === "headers" ? <HeaderPresetEditor /> : null}

              {tab === "mock" ? <MockGroupEditor onOpenFaultRules={onOpenFaultRules} /> : null}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
