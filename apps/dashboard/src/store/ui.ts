import { create } from "zustand";
import type { MethodFilter, SortMode, StatusFilter } from "../lib/filters";

export type Theme = "light" | "dark";

const THEME_KEY = "proxira.theme";

const readTheme = (): Theme => {
  if (typeof document === "undefined") return "dark";
  const current = document.documentElement.dataset.theme;
  return current === "light" ? "light" : "dark";
};

const applyTheme = (theme: Theme): void => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 隐私模式忽略持久化即可。
  }
};

export type DetailTab =
  | "overview"
  | "response-body"
  | "response-headers"
  | "request-body"
  | "request-headers"
  | "query";

type UiState = {
  theme: Theme;
  toggleTheme: () => void;

  searchText: string;
  methodFilter: MethodFilter;
  statusFilter: StatusFilter;
  sortMode: SortMode;
  setSearchText: (value: string) => void;
  setMethodFilter: (value: MethodFilter) => void;
  setStatusFilter: (value: StatusFilter) => void;
  setSortMode: (value: SortMode) => void;
  resetFilters: () => void;

  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;

  showSensitive: boolean;
  toggleSensitive: () => void;

  listPanelOpen: boolean;
  setListPanelOpen: (open: boolean) => void;

  /** 窄屏专注模式：隐藏顶栏与转发地址区，详情整屏显示。 */
  detailFocused: boolean;
  setDetailFocused: (focused: boolean) => void;
};

export const useUiStore = create<UiState>((set, get) => ({
  theme: readTheme(),
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },

  searchText: "",
  methodFilter: "ALL",
  statusFilter: "ALL",
  sortMode: "time_desc",
  setSearchText: (value) => set({ searchText: value }),
  setMethodFilter: (value) => set({ methodFilter: value }),
  setStatusFilter: (value) => set({ statusFilter: value }),
  setSortMode: (value) => set({ sortMode: value }),
  resetFilters: () =>
    set({
      searchText: "",
      methodFilter: "ALL",
      statusFilter: "ALL",
      sortMode: "time_desc",
    }),

  // 默认落在「概览」：选中一条请求时先看全貌，再按需切到 Body / Headers。
  activeTab: "overview",
  setActiveTab: (tab) => set({ activeTab: tab }),

  showSensitive: false,
  toggleSensitive: () => set((state) => ({ showSensitive: !state.showSensitive })),

  listPanelOpen: false,
  setListPanelOpen: (open) => set({ listPanelOpen: open }),

  detailFocused: false,
  setDetailFocused: (focused) => set({ detailFocused: focused }),
}));
