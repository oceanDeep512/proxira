import { create } from "zustand";

export type ToastLevel = "success" | "error" | "info";

export type ToastMessage = {
  id: number;
  text: string;
  level: ToastLevel;
};

type ToastState = {
  messages: ToastMessage[];
  push: (text: string, level?: ToastLevel) => void;
  dismiss: (id: number) => void;
  clear: () => void;
};

const timers = new Map<number, ReturnType<typeof setTimeout>>();
let seed = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  messages: [],
  push: (text, level = "info") => {
    const id = ++seed;
    set((state) => ({ messages: [...state.messages, { id, text, level }] }));
    timers.set(
      id,
      setTimeout(() => {
        get().dismiss(id);
      }, 3200),
    );
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((state) => ({ messages: state.messages.filter((item) => item.id !== id) }));
  },
  clear: () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ messages: [] });
  },
}));

export const toast = {
  success: (text: string) => useToastStore.getState().push(text, "success"),
  error: (text: string) => useToastStore.getState().push(text, "error"),
  info: (text: string) => useToastStore.getState().push(text, "info"),
};
