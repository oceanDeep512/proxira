export type OSType = "macos" | "windows" | "linux" | "unknown";

import { LAN_HOST_ALIAS } from "./shared/network.js";

export const detectOS = (platform: string): OSType => {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "unknown";
};

export interface InstallGuide {
  title: string;
  steps: string[];
}

export const getInstallGuide = (os: OSType): InstallGuide => {
  switch (os) {
    case "macos":
      return {
        title: "macOS 安装指南",
        steps: [
          "方式一（推荐）：使用 Homebrew 安装",
          "  brew install openssl",
          "",
          "方式二：从官网下载安装",
          "  访问 https://www.openssl.org/ 下载并安装",
        ],
      };
    case "windows":
      return {
        title: "Windows 安装指南",
        steps: [
          "方式一（推荐）：使用 Chocolatey 安装",
          "  choco install openssl",
          "",
          "方式二：从官网下载安装",
          "  访问 https://slproweb.com/products/Win32OpenSSL.html 下载并安装",
          "  安装后记得将 OpenSSL 添加到系统 PATH 环境变量",
        ],
      };
    case "linux":
      return {
        title: "Linux 安装指南",
        steps: [
          "方式一（推荐）：使用包管理器安装",
          "  Ubuntu/Debian: sudo apt-get install openssl",
          "  CentOS/RHEL: sudo yum install openssl",
          "  Arch Linux: sudo pacman -S openssl",
          "",
          "方式二：从源码编译安装",
          "  访问 https://www.openssl.org/ 下载源码编译",
        ],
      };
    case "unknown":
      return {
        title: "安装指南",
        steps: ["请访问 https://www.openssl.org/ 下载并安装 OpenSSL"],
      };
  }
};

export interface PackageManagerCheck {
  (): boolean;
}

export const getInstallCommand = (
  os: OSType,
  hasHomebrew: boolean,
  hasChocolatey: boolean,
  hasApt: boolean,
): string | null => {
  switch (os) {
    case "macos":
      return hasHomebrew ? "brew install openssl" : null;
    case "windows":
      return hasChocolatey ? "choco install openssl" : null;
    case "linux":
      return hasApt ? "sudo apt-get update && sudo apt-get install -y openssl" : null;
    default:
      return null;
  }
};

export const validateCertDays = (daysRaw: string | undefined): number => {
  const days = daysRaw ? Number(daysRaw) : 365;
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("证书有效期天数必须是正整数");
  }
  return days;
};

export const validateCommonName = (commonNameRaw: string | undefined): string => {
  const trimmed = commonNameRaw?.trim();
  if (!trimmed) {
    return "localhost";
  }
  return trimmed;
};

/**
 * 解析 `--host` 的值：它可以不带值单独使用，`proxira --host` 等价于 `--host lan`
 * （开放到局域网）。判断是否吃掉下一个 token 的规则是：下一个 token 以 `-`
 * 开头就说明它是另一个参数，而不是 host 的值。
 */
export const resolveHostFlag = (
  inlineValue: string | undefined,
  nextToken: string | undefined,
): { value: string; consumesNext: boolean } => {
  if (inlineValue !== undefined) {
    const trimmed = inlineValue.trim();
    // `--host=` 空值同样按开关处理，不去监听一个空字符串。
    return {
      value: trimmed.length > 0 ? trimmed : LAN_HOST_ALIAS,
      consumesNext: false,
    };
  }
  if (nextToken !== undefined && !nextToken.startsWith("-")) {
    return { value: nextToken, consumesNext: true };
  }
  return { value: LAN_HOST_ALIAS, consumesNext: false };
};
