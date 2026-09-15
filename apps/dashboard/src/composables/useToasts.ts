import { ref } from "vue";
import type { ToastLevel, ToastMessage } from "../types.js";

const toastMessages = ref<ToastMessage[]>([]);
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
let toastId = 0;

export const dismissToast = (id: number): void => {
  const timer = toastTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    toastTimers.delete(id);
  }
  toastMessages.value = toastMessages.value.filter((item) => item.id !== id);
};

export const pushToast = (
  text: string,
  level: ToastLevel = "info",
): void => {
  const id = ++toastId;
  toastMessages.value = [...toastMessages.value, { id, text, level }];
  const timer = setTimeout(() => {
    dismissToast(id);
  }, 2800);
  toastTimers.set(id, timer);
};

export const clearAllToasts = (): void => {
  for (const timer of toastTimers.values()) {
    clearTimeout(timer);
  }
  toastTimers.clear();
  toastMessages.value = [];
};

export const useToasts = () => {
  return { toastMessages, pushToast, dismissToast, clearAllToasts };
};
