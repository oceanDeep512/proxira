import { useCallback, useState } from "react";
import { toast } from "../store/toast";

export const writeClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/** 复制并自动提示；空内容给出中性反馈而不是静默失败。 */
export const useCopy = (): {
  copy: (label: string, text: string) => Promise<void>;
  copied: string | null;
} => {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback(async (label: string, text: string) => {
    if (!text) {
      toast.info(`${label} 为空`);
      return;
    }
    const ok = await writeClipboard(text);
    if (ok) {
      setCopied(label);
      toast.success(`已复制 ${label}`);
      window.setTimeout(() => setCopied(null), 1400);
      return;
    }
    toast.error(`复制 ${label} 失败，请检查浏览器权限`);
  }, []);

  return { copy, copied };
};
