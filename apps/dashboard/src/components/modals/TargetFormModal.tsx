import { useEffect, useState } from "react";
import { Field, Input } from "../ui/Field";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

export type TargetFormValue = {
  name: string;
  targetBaseUrl: string;
  upstreamTimeoutMs: number | null;
};

export const TargetFormModal = ({
  open,
  onOpenChange,
  mode,
  initialValue,
  loading,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialValue: TargetFormValue;
  loading: boolean;
  onSubmit: (value: TargetFormValue) => void;
}) => {
  const [name, setName] = useState(initialValue.name);
  const [url, setUrl] = useState(initialValue.targetBaseUrl);
  const [timeoutMs, setTimeoutMs] = useState(
    initialValue.upstreamTimeoutMs === null ? "" : String(initialValue.upstreamTimeoutMs),
  );

  // 每次打开都从最新的转发地址重新填充，避免上一次的输入残留。
  useEffect(() => {
    if (!open) return;
    setName(initialValue.name);
    setUrl(initialValue.targetBaseUrl);
    setTimeoutMs(
      initialValue.upstreamTimeoutMs === null ? "" : String(initialValue.upstreamTimeoutMs),
    );
  }, [open, initialValue]);

  const parsedTimeout = timeoutMs.trim() === "" ? null : Number(timeoutMs);
  const timeoutInvalid =
    parsedTimeout !== null && (!Number.isFinite(parsedTimeout) || parsedTimeout < 0);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "create" ? "新增转发地址" : "编辑当前转发地址"}
      description={
        mode === "create"
          ? "创建后不会自动切换，当前请求仍走现有地址，需要时再到顶部下拉里切换。"
          : "修改当前转发地址的名称与地址，地址仍需保持唯一。"
      }
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={loading || !name.trim() || !url.trim() || timeoutInvalid}
            onClick={() =>
              onSubmit({
                name,
                targetBaseUrl: url,
                upstreamTimeoutMs: timeoutInvalid ? null : parsedTimeout,
              })
            }
          >
            {loading ? "保存中…" : mode === "create" ? "创建" : "保存"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="名称">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：本地服务"
            autoFocus
          />
        </Field>

        <Field label="转发地址" hint="必须是 http/https 开头的完整地址">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://api.example.com"
            inputMode="url"
          />
        </Field>

        <Field label="上游超时（毫秒）" hint="留空表示使用全局默认超时">
          <Input
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
            placeholder="例如：15000"
            inputMode="numeric"
          />
        </Field>

        {timeoutInvalid ? (
          <p className="m-0 text-[12px] text-danger">超时必须是非负数字。</p>
        ) : null}
      </div>
    </Modal>
  );
};
