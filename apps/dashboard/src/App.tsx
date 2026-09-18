import { useEffect, useMemo, useState } from "react";
import type { ProxyGroup } from "@proxira/core";
import {
  selectActiveTarget,
  useProxiraStore,
  type ReplayResult,
} from "./store/proxira";
import { useUiStore } from "./store/ui";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { TopBar } from "./components/layout/TopBar";
import { TargetHub } from "./components/layout/TargetHub";
import { RecordList } from "./components/records/RecordList";
import { DetailPanel } from "./components/detail/DetailPanel";
import { ConfirmDialog } from "./components/modals/ConfirmDialog";
import { TargetFormModal, type TargetFormValue } from "./components/modals/TargetFormModal";
import { RuleManagerModal } from "./components/modals/RuleManagerModal";
import { ReplayDialog } from "./components/modals/ReplayDialog";
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

  const setListPanelOpen = useUiStore((state) => state.setListPanelOpen);
  const showSensitive = useUiStore((state) => state.showSensitive);

  const [targetModal, setTargetModal] = useState<{ mode: "create" | "edit" } | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);

  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void bootstrap();
    return () => {
      bootstrapped = false;
      disconnectSse();
    };
  }, [bootstrap, disconnectSse]);

  // 窄屏进入时把历史列表收起，保证详情第一眼可见。
  useEffect(() => {
    if (!isWide) setListPanelOpen(false);
  }, [isWide, setListPanelOpen]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) ?? records[0] ?? null,
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
  }): Promise<void> => {
    const result = await replayRecord({
      method: payload.method,
      url: payload.url,
      headers: parseHeaderLines(payload.headersText),
      body: payload.body,
    });
    if (result) setReplayResult(result);
  };

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={200}>
      <div
        className={[
          "relative z-[1] flex min-h-dvh flex-wrap content-start gap-3 p-3",
          "panel:h-dvh panel:min-h-0 panel:flex-col panel:flex-nowrap panel:overflow-hidden",
        ].join(" ")}
      >
        <TopBar onReset={() => setResetModalOpen(true)} resetting={resettingAll} />

        {/* 窄屏：workspace / left-column 两层盒子被 contents 拆掉，
            让 转发地址 与 顶栏 直接成为同一行的 flex 项（沿用原面板的断点行为）。 */}
        <div className="contents panel:flex panel:min-h-0 panel:flex-1 panel:flex-nowrap panel:gap-3">
          <div className="contents panel:flex panel:w-[clamp(300px,24vw,384px)] panel:shrink-0 panel:flex-col panel:gap-3 panel:min-h-0">
            <TargetHub
              onCreate={() => setTargetModal({ mode: "create" })}
              onEdit={() => setTargetModal({ mode: "edit" })}
              onDelete={() => setDeleteModalOpen(true)}
              onRules={openRulesModal}
            />
            <RecordList isWide={isWide} />
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

      <Toaster />
    </TooltipProvider>
  );
};

export default App;
