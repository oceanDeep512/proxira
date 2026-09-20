import { useEffect, useMemo, useState } from "react";
import type { ProxyGroup } from "@proxira/core";
import {
  selectActiveTarget,
  useProxiraStore,
  type ReplayResult,
} from "./store/proxira";
import { useUiStore } from "./store/ui";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { cn } from "./lib/cn";
import { TopBar } from "./components/layout/TopBar";
import { TargetHub } from "./components/layout/TargetHub";
import { RecordList } from "./components/records/RecordList";
import { NewRecordNotice } from "./components/records/NewRecordNotice";
import { DetailPanel } from "./components/detail/DetailPanel";
import { ConfirmDialog } from "./components/modals/ConfirmDialog";
import { TargetFormModal, type TargetFormValue } from "./components/modals/TargetFormModal";
import { RuleManagerModal } from "./components/modals/RuleManagerModal";
import { RequestHeadersModal } from "./components/modals/RequestHeadersModal";
import { ReplayDialog } from "./components/modals/ReplayDialog";
import { SettingsModal } from "./components/modals/SettingsModal";
import { Toaster } from "./components/ui/Toaster";
import { TooltipProvider } from "./components/ui/Tooltip";

// StrictMode 下 effect 会跑两次，用一个模块级标记挡掉重复初始化（会重复建 SSE）。
let bootstrapped = false;

const parseHeaderLines = (text: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator === -1) continue;
    headers[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return headers;
};

const App = () => {
  const isWide = useMediaQuery("(min-width: 960px)");

  const records = useProxiraStore((state) => state.records);
  const selectedRecordId = useProxiraStore((state) => state.selectedRecordId);
  const activeTarget = useProxiraStore(selectActiveTarget);
  const rules = useProxiraStore((state) => state.rules);
  const resettingAll = useProxiraStore((state) => state.resettingAll);
  const targetModalSubmitting = useProxiraStore((state) => state.targetModalSubmitting);
  const deleteTargetSubmitting = useProxiraStore((state) => state.deleteTargetSubmitting);
  const replaying = useProxiraStore((state) => state.replaying);

  const bootstrap = useProxiraStore((state) => state.bootstrap);
  const disconnectSse = useProxiraStore((state) => state.disconnectSse);
  const createTarget = useProxiraStore((state) => state.createTarget);
  const saveActiveTarget = useProxiraStore((state) => state.saveActiveTarget);
  const deleteTarget = useProxiraStore((state) => state.deleteTarget);
  const resetAll = useProxiraStore((state) => state.resetAll);
  const saveRule = useProxiraStore((state) => state.saveRule);
  const removeRule = useProxiraStore((state) => state.removeRule);
  const toggleRule = useProxiraStore((state) => state.toggleRule);
  const fetchRules = useProxiraStore((state) => state.fetchRules);
  const replayRecord = useProxiraStore((state) => state.replayRecord);
  const saveTargetHeaders = useProxiraStore((state) => state.saveTargetHeaders);

  const setListPanelOpen = useUiStore((state) => state.setListPanelOpen);
  const showSensitive = useUiStore((state) => state.showSensitive);
  const detailFocused = useUiStore((state) => state.detailFocused);
  const setDetailFocused = useUiStore((state) => state.setDetailFocused);

  const [targetModal, setTargetModal] = useState<{ mode: "create" | "edit" } | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [headersModalOpen, setHeadersModalOpen] = useState(false);
  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);

  const settingsOpen = useProxiraStore((state) => state.settingsOpen);
  const setSettingsOpen = useProxiraStore((state) => state.setSettingsOpen);

  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void bootstrap();
    return () => {
      bootstrapped = false;
      disconnectSse();
    };
  }, [bootstrap, disconnectSse]);

  // 窄屏进入时把历史列表收起，保证详情第一眼可见；
  // 宽屏是双栏，专注模式没有意义，顺手复位避免状态残留。
  useEffect(() => {
    if (!isWide) {
      setListPanelOpen(false);
      return;
    }
    setDetailFocused(false);
  }, [isWide, setListPanelOpen, setDetailFocused]);

  // Esc 退出专注模式。焦点在输入框里时让给搜索框自己的清空逻辑。
  useEffect(() => {
    if (!detailFocused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      setDetailFocused(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailFocused, setDetailFocused]);

  // 只跟随 selectedRecordId：删掉当前选中的那条后它是 null，详情区就该空着。
  // 此前 fallback 到 records[0]，导致「删了这条却跑出下一条」。
  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) ?? null,
    [records, selectedRecordId],
  );

  const maxDurationMs = useMemo(
    () => records.reduce((max, record) => Math.max(max, record.durationMs), 0),
    [records],
  );

  const targetFormValue: TargetFormValue = {
    name: activeTarget?.name ?? "",
    targetBaseUrl: activeTarget?.targetBaseUrl ?? "",
    upstreamTimeoutMs: activeTarget?.upstreamTimeoutMs ?? null,
  };

  const submitTargetForm = async (value: TargetFormValue): Promise<void> => {
    const ok =
      targetModal?.mode === "create"
        ? await createTarget(value.name, value.targetBaseUrl, value.upstreamTimeoutMs)
        : await saveActiveTarget(value.name, value.targetBaseUrl, value.upstreamTimeoutMs);
    if (ok) setTargetModal(null);
  };

  const confirmDeleteTarget = async (): Promise<void> => {
    const target = activeTarget as ProxyGroup | null;
    if (!target) return;
    const ok = await deleteTarget(target);
    if (ok) setDeleteModalOpen(false);
  };

  const confirmReset = async (): Promise<void> => {
    const ok = await resetAll();
    if (ok) setResetModalOpen(false);
  };

  const openRulesModal = (): void => {
    setRulesModalOpen(true);
    void fetchRules().catch(() => undefined);
  };

  const submitReplay = async (payload: {
    method: string;
    url: string;
    headersText: string;
    body: string;
    useCustomHeaders: boolean;
  }): Promise<void> => {
    const result = await replayRecord({
      method: payload.method,
      url: payload.url,
      headers: parseHeaderLines(payload.headersText),
      body: payload.body,
      useCustomHeaders: payload.useCustomHeaders,
    });
    if (result) setReplayResult(result);
  };

  // 桌面软件骨架：整块锁在 100dvh 内，页面本身永不滚动，
  // 只有列表和正文各自内部滚。窄屏也是同一套（纵向堆叠 + 内部分区滚动），
  // 这样任何窗口尺寸下布局都成立。
  // 注意：注释必须留在 return 外，写进 JSX children 会被当成文本渲染出去。
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={200}>
      <div className="relative z-[1] flex h-dvh flex-col flex-nowrap overflow-hidden bg-surface">
        {/* 专注模式只在窄屏生效：用 max-panel 限定，拉宽窗口会自动恢复，
            不会出现「宽屏下顶栏不见了」的死角。 */}
        <TopBar
          onOpenSettings={() => setSettingsOpen(true)}
          className={cn(detailFocused && "max-panel:hidden")}
        />

        {/* 新请求提示：独占一行夹在顶栏和面板之间，不压在面板上。
            没有新请求时行高收成 0，面板紧贴顶栏。 */}
        <NewRecordNotice />

        {/* 窄屏纵向堆叠、宽屏左右分栏；这一层负责分配除顶栏外的全部高度。 */}
        <div className="flex min-h-0 flex-1 flex-col panel:flex-row panel:flex-nowrap">
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-col",
              // 窄屏：历史请求改由转发地址那一行里的选择器唤起对话框，
              // 左栏只剩转发地址这一块，高度自适应，剩下的全给详情。
              "max-panel:shrink-0",
              // 专注模式下整列让位给详情（窄屏左列本来就只剩转发地址区）。
              detailFocused && "max-panel:hidden",
              // 宽屏：定宽侧栏 + 右侧分隔线
              "panel:w-[clamp(300px,24vw,384px)] panel:shrink-0 panel:border-r panel:border-line",
            )}
          >
            <TargetHub
              onCreate={() => setTargetModal({ mode: "create" })}
              onEdit={() => setTargetModal({ mode: "edit" })}
              onDelete={() => setDeleteModalOpen(true)}
            />
            {/* 窄屏整块隐藏（改走对话框选择器），宽屏仍是常驻侧栏。
                用 CSS 隐藏而不是卸载，切换尺寸时筛选条件不会丢。 */}
            <RecordList isWide={isWide} className="max-panel:hidden" />
          </div>

          <DetailPanel
            record={selectedRecord}
            maxDurationMs={maxDurationMs}
            onReplay={() => setReplayModalOpen(true)}
            replaying={replaying}
          />
        </div>
      </div>

      <TargetFormModal
        open={targetModal !== null}
        onOpenChange={(open) => !open && setTargetModal(null)}
        mode={targetModal?.mode ?? "create"}
        initialValue={targetFormValue}
        loading={targetModalSubmitting}
        onSubmit={submitTargetForm}
      />

      <ConfirmDialog
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        title="确认删除转发地址"
        message={`将删除转发地址「${activeTarget?.name ?? ""}」，并清除该转发地址下的所有历史请求数据。此操作不可恢复。`}
        tips={["该转发地址下的历史记录会一并清除。", "删除后无法撤销。"]}
        confirmText="确认删除"
        loading={deleteTargetSubmitting}
        danger
        onConfirm={() => void confirmDeleteTarget()}
      />

      <ConfirmDialog
        open={resetModalOpen}
        onOpenChange={setResetModalOpen}
        title="确认重置全部内容"
        message="重置后将立即恢复到初始状态。"
        tips={[
          "会删除所有转发地址配置，仅保留一个默认转发地址。",
          "会清空全部历史请求记录。",
          "操作不可撤销，请确认当前数据已无需保留。",
        ]}
        confirmText="确认重置"
        loading={resettingAll}
        danger
        onConfirm={() => void confirmReset()}
      />

      <RuleManagerModal
        open={rulesModalOpen}
        onOpenChange={setRulesModalOpen}
        rules={rules}
        onCreate={async (payload) => {
          await saveRule(payload);
        }}
        onUpdate={async ({ id, patch }) => {
          await saveRule(patch, id);
        }}
        onRemove={(id) => removeRule(id)}
        onToggle={(rule) => void toggleRule(rule)}
      />

      <RequestHeadersModal
        open={headersModalOpen}
        onOpenChange={setHeadersModalOpen}
        targetId={activeTarget?.id ?? ""}
        targetName={activeTarget?.name ?? ""}
        customHeaders={activeTarget?.customHeaders ?? []}
        headerRules={activeTarget?.headerRules ?? []}
        onSubmit={saveTargetHeaders}
      />

      <ReplayDialog
        open={replayModalOpen}
        onOpenChange={setReplayModalOpen}
        record={selectedRecord}
        loading={replaying}
        redact={!showSensitive}
        result={replayResult}
        onOpenChangeResult={setReplayResult}
        onSubmit={submitReplay}
      />

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onOpenHeaders={() => {
          setSettingsOpen(false);
          setHeadersModalOpen(true);
        }}
        onOpenRules={() => {
          setSettingsOpen(false);
          openRulesModal();
        }}
        onRequestReset={() => setResetModalOpen(true)}
      />

      <Toaster />
    </TooltipProvider>
  );
};

export default App;
