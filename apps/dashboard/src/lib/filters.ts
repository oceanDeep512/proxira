import type { ProxyTrafficRecord } from "@proxira/core";

export const METHOD_FILTER_OPTIONS = [
  { value: "ALL", label: "全部请求", hint: "不过滤 Method" },
  { value: "GET", label: "GET", hint: "读取类请求" },
  { value: "POST", label: "POST", hint: "创建类请求" },
  { value: "PUT", label: "PUT", hint: "覆盖更新" },
  { value: "PATCH", label: "PATCH", hint: "局部更新" },
  { value: "DELETE", label: "DELETE", hint: "删除类请求" },
  { value: "OPTIONS", label: "OPTIONS", hint: "预检与能力探测" },
  { value: "HEAD", label: "HEAD", hint: "只看响应头" },
] as const;

export const STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "全部状态", hint: "不过滤 Status" },
  { value: "2xx", label: "2xx 成功", hint: "请求成功" },
  { value: "3xx", label: "3xx 重定向", hint: "发生跳转" },
  { value: "4xx", label: "4xx 客户端错误", hint: "请求参数问题" },
  { value: "5xx", label: "5xx 服务端错误", hint: "上游异常" },
  { value: "ERROR", label: "ERR 异常", hint: "代理或网络失败" },
] as const;

export const SORT_OPTIONS = [
  { value: "time_desc", label: "时间从新到旧", hint: "按请求时间倒序" },
  { value: "time_asc", label: "时间从旧到新", hint: "按请求时间正序" },
  { value: "duration_desc", label: "耗时从高到低", hint: "优先查看慢请求" },
  { value: "duration_asc", label: "耗时从低到高", hint: "优先查看快请求" },
] as const;

export type MethodFilter = (typeof METHOD_FILTER_OPTIONS)[number]["value"];
export type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]["value"];
export type SortMode = (typeof SORT_OPTIONS)[number]["value"];

export const isMethodFilter = (value: string): value is MethodFilter =>
  METHOD_FILTER_OPTIONS.some((option) => option.value === value);

export const isStatusFilter = (value: string): value is StatusFilter =>
  STATUS_FILTER_OPTIONS.some((option) => option.value === value);

export const isSortMode = (value: string): value is SortMode =>
  SORT_OPTIONS.some((option) => option.value === value);

export const normalizeTargetInput = (value: string): string | null => {
  const source = value.trim();
  if (!source) {
    return null;
  }

  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const matchesStatusFilter = (
  record: ProxyTrafficRecord,
  statusFilter: StatusFilter,
): boolean => {
  if (statusFilter === "ALL") {
    return true;
  }
  if (statusFilter === "ERROR") {
    return record.error !== null;
  }

  const status = record.responseStatus;
  if (status === null) {
    return false;
  }
  if (statusFilter === "2xx") {
    return status >= 200 && status < 300;
  }
  if (statusFilter === "3xx") {
    return status >= 300 && status < 400;
  }
  if (statusFilter === "4xx") {
    return status >= 400 && status < 500;
  }
  return status >= 500 && status < 600;
};

export const filterAndSortRecords = (
  source: ProxyTrafficRecord[],
  options: {
    methodFilter: MethodFilter;
    statusFilter: StatusFilter;
    sortMode: SortMode;
    searchText?: string;
  },
): ProxyTrafficRecord[] => {
  const keyword = options.searchText?.trim().toLowerCase() ?? "";

  const items = source.filter((record) => {
    if (options.methodFilter !== "ALL" && record.method !== options.methodFilter) {
      return false;
    }
    if (!matchesStatusFilter(record, options.statusFilter)) {
      return false;
    }
    if (keyword) {
      return record.path.toLowerCase().includes(keyword);
    }
    return true;
  });

  if (options.sortMode === "duration_desc") {
    items.sort((left, right) => right.durationMs - left.durationMs);
  } else if (options.sortMode === "duration_asc") {
    items.sort((left, right) => left.durationMs - right.durationMs);
  } else if (options.sortMode === "time_asc") {
    items.sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    );
  } else {
    items.sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
    );
  }

  return items;
};
