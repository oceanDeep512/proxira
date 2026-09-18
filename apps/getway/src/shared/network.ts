import { networkInterfaces } from "node:os";

export type HostReachability = "loopback" | "wildcard" | "specific";

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "0:0:0:0:0:0:0:1",
]);

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "*"]);

// `--host lan` 是给「我只想让局域网里其他机器连进来」用的别名。
// 展开成 0.0.0.0（监听所有网卡）——比让用户记住 0.0.0.0 是什么意思友好得多，
// 也避免用户以为要填自己那台机器的 IP（换网络就会失效）。
export const LAN_HOST_ALIAS = "lan";

export const expandHostAlias = (host: string): string =>
  host.trim().toLowerCase() === LAN_HOST_ALIAS ? "0.0.0.0" : host;

const isIpv4Literal = (value: string): boolean => {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    return Number(part) <= 255;
  });
};

/**
 * `--host` 填错时，node 只会抛一句 `getaddrinfo ENOTFOUND`，看不出该怎么改。
 * 这里给出能直接照抄的例子。
 */
export const validateHost = (
  host: string,
  lanAddresses: readonly string[] = listLanAddresses(),
): { ok: true } | { ok: false; message: string } => {
  const value = expandHostAlias(host).trim();
  if (WILDCARD_HOSTS.has(value.toLowerCase())) {
    return { ok: true };
  }
  if (LOOPBACK_HOSTS.has(value.toLowerCase())) {
    return { ok: true };
  }
  if (isIpv4Literal(value)) {
    // 填了本机没有的地址时，绑定会失败或绑到别的网卡上，提前说清楚。
    if (!lanAddresses.includes(value) && !value.startsWith("127.")) {
      return {
        ok: false,
        message:
          `监听地址 ${value} 不是本机的网卡地址。` +
          (lanAddresses.length > 0
            ? `本机可用：${lanAddresses.join("、")}；想让局域网其他设备访问用 --host lan。`
            : "未检测到局域网地址；想让局域网其他设备访问用 --host lan。"),
      };
    }
    return { ok: true };
  }
  if (value.toLowerCase() === "localhost") {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      `监听地址 "${host}" 无效。可用写法：--host 127.0.0.1（仅本机）、` +
      `--host 0.0.0.0 或 --host lan（局域网可访问）、--host <本机 IP>。`,
  };
};

export const describeHostReachability = (host: string): HostReachability => {
  const normalized = expandHostAlias(host).trim().toLowerCase();
  // `::` 既是通配又是回环语义，先判通配，否则会被误判成 loopback。
  if (WILDCARD_HOSTS.has(normalized)) {
    return "wildcard";
  }
  if (LOOPBACK_HOSTS.has(normalized)) {
    return "loopback";
  }
  if (normalized.startsWith("127.")) {
    return "loopback";
  }
  return "specific";
};

const isIpv4 = (family: string | number): boolean =>
  family === "IPv4" || family === 4;

// 169.254.0.0/16 是链路本地地址（没拿到 DHCP 时才会出现），不能用于共享。
const isLinkLocal = (address: string): boolean => address.startsWith("169.254.");

// 198.18.0.0/15 是 RFC 2544 保留的基准测试段。Surge / Clash 等工具的 fake-ip
// 模式会把它挂成虚拟网卡，它不是真实局域网地址，混进来纯属噪音。
const isBenchmarkRange = (address: string): boolean => {
  const [first, second] = address.split(".").map(Number);
  return first === 198 && second !== undefined && second >= 18 && second <= 19;
};

/**
 * 列出本机可用于局域网访问的非回环 IPv4 地址。
 * `interfaces` 可注入，便于单测（真实机器上拿到的网卡列表不可控）。
 */
export const listLanAddresses = (
  interfaces: Record<string, readonly unknown[] | undefined> = networkInterfaces(),
): string[] => {
  const found = new Set<string>();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const { address, family, internal } = entry as {
        address?: unknown;
        family?: unknown;
        internal?: unknown;
      };
      if (internal === true) {
        continue;
      }
      if (typeof address !== "string" || address.length === 0) {
        continue;
      }
      if (typeof family !== "string" && typeof family !== "number") {
        continue;
      }
      if (!isIpv4(family)) {
        continue;
      }
      if (isLinkLocal(address) || isBenchmarkRange(address)) {
        continue;
      }
      found.add(address);
    }
  }

  return [...found].sort(compareIpv4);
};

const compareIpv4 = (left: string, right: string): number => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 4; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

/**
 * 根据监听地址判断哪些局域网地址真的能连进来：
 * - 监听 127.0.0.1 时，局域网地址一律连不上，返回空（不要展示一个同事打不开的 URL）
 * - 监听 0.0.0.0 时，所有局域网地址都可用
 * - 监听某个具体地址时，只有它自己可用
 */
export const resolveReachableAddresses = (
  host: string,
  lanAddresses: readonly string[] = listLanAddresses(),
): string[] => {
  const reachability = describeHostReachability(host);
  if (reachability === "loopback") {
    return [];
  }
  if (reachability === "wildcard") {
    return [...lanAddresses];
  }
  return lanAddresses.includes(host) ? [host] : [];
};
