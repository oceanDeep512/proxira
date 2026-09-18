/**
 * 面板与内核之间的只读契约层。
 * 路由前缀 `/_proxira/api`、查询键 `groupId`、请求体键 `activeGroupId`
 * 都是 wire 契约，改名会让老客户端直接失效 —— 这里统一收口，别在组件里散写。
 */

const apiBase =
  ((import.meta.env.VITE_PROXY_API_BASE as string | undefined) ?? "").replace(/\/$/, "");

const TOKEN_STORAGE_KEY = "proxira.access-token";

// 访问令牌：URL 上带一次 ?token=... 之后留在会话里，EventSource 也一起带上。
const resolveAccessToken = (): string => {
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get("token")?.trim();
  if (fromUrl) {
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, fromUrl);
    } catch {
      // 隐私模式下写不进去，就只用 URL 里的值。
    }
    return fromUrl;
  }
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
};

const accessToken = resolveAccessToken();

export const withAccessToken = (url: string): string => {
  if (!accessToken) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(accessToken)}`;
};

export const apiUrl = (path: string): string => withAccessToken(`${apiBase}${path}`);

export const apiFetch = (path: string, init?: RequestInit): Promise<Response> =>
  fetch(apiUrl(path), init);

export const extractErrorMessage = async (
  response: Response,
  fallback: string,
): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload?.message) return payload.message;
  } catch {
    // 非 JSON 响应就用兜底文案。
  }
  return fallback;
};
