import { useCallback, useState } from "react";
import { toast } from "../store/toast";

/**
 * 兜底复制：`document.execCommand("copy")` 已废弃，但它是**非安全上下文里唯一还能用**的
 * 写入方式，所以必须保留。
 *
 * 为什么需要它：`navigator.clipboard` 只在安全上下文（https 或 localhost）存在。
 * 用 `--host` 把代理开放到局域网后，别的机器是 `http://192.168.x.x:3000` 访问的，
 * 那里 `navigator.clipboard` 直接是 undefined，所有复制按钮（顶部「复制」和 JSON
 * 树行内的节点复制）都会静默失败。
 */
const copyViaExecCommand = (text: string): boolean => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // 必须真的在文档里且能被选中，但不能让用户看见跳动：挪到视口外即可，
  // 不要 display:none / visibility:hidden —— 那样选不中。
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.append(textarea);

  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textarea.select();
  // execCommand 要求「用户手势」，所以调用方必须同步走到这里，中间不能 await。
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  textarea.remove();
  if (selection && previousRange) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }
  return ok;
};

export const writeClipboard = async (text: string): Promise<boolean> => {
  // 注意：clipboard 存在时也要能在失败后回退（权限被拒、文档未聚焦都会抛），
  // 所以这里不用 if/else，而是「成功就 return，其余都掉到兜底」。
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 落到下面的 execCommand 兜底
    }
  }
  return copyViaExecCommand(text);
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
    toast.error(`复制 ${label} 失败，可手动选中内容复制`);
  }, []);

  return { copy, copied };
};
