#!/usr/bin/env node
import boxen from "boxen";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROXIRA_LOGO_LINES } from "./logo.js";

type CliFlags = {
  mode: "serve" | "clear-cache";
  help: boolean;
  version: boolean;
  noBanner: boolean;
  port?: string;
  target?: string;
  dataDir?: string;
};

const CLI_VERSION = (() => {
  try {
    const cliDir = dirname(fileURLToPath(import.meta.url));
    const packagePath = resolve(cliDir, "../package.json");
    const packageRaw = readFileSync(packagePath, "utf8");
    const packageData = JSON.parse(packageRaw) as { version?: string };
    return packageData.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const printHelp = (): void => {
  const logo = PROXIRA_LOGO_LINES.map((line, index) =>
    [chalk.cyanBright, chalk.blueBright, chalk.magentaBright][index % 3]!(line),
  ).join("\n");

  const usage = [
    logo,
    "",
    `${chalk.bold("Proxira 命令行工具")}`,
    "",
    `${chalk.bold("用法")}`,
    "  proxira [options]",
    "  proxira clear-cache [options]",
    "",
    `${chalk.bold("参数说明")}`,
    "  -p, --port <port>          代理服务端口，默认 3000",
    "  -t, --target <url>         上游服务地址（例如 http://localhost:8080）",
    "  -d, --data-dir <path>      配置目录（默认 ./.proxira）",
    "      --no-banner            关闭启动 Banner 输出",
    "  -h, --help                 查看帮助信息",
    "  -v, --version              查看当前 CLI 版本",
    "",
    `${chalk.bold("子命令")}`,
    "  clear-cache                清除本地缓存（配置 + 历史记录）",
    "",
    `${chalk.bold("参数传递方式")}`,
    "  --port 3010                使用空格传值",
    "  --port=3010                使用等号传值",
    "  --target http://x.x.x.x    URL 推荐使用完整协议头（http/https）",
    "",
    `${chalk.bold("示例")}`,
    "  proxira",
    "  proxira --port 3010 --target http://localhost:8080",
    "  proxira --port=3010 --target=http://localhost:8080",
    "  proxira -p 3001 -d ./.proxira",
    "  proxira clear-cache",
    "  proxira clear-cache --data-dir ./.proxira",
  ].join("\n");

  console.log(
    boxen(usage, {
      borderStyle: "round",
      borderColor: "cyan",
      padding: { top: 0, right: 1, bottom: 0, left: 1 },
    }),
  );
};

const parseFlags = (argv: string[]): CliFlags => {
  const normalizedInput = argv.filter((token) => token !== "--");
  const flags: CliFlags = {
    mode: "serve",
    help: false,
    version: false,
    noBanner: false,
  };

  const normalized =
    normalizedInput[0] === "clear-cache" ? normalizedInput.slice(1) : normalizedInput;
  if (normalizedInput[0] === "clear-cache") {
    flags.mode = "clear-cache";
  }

  const ensureServeOnly = (token: string): void => {
    if (flags.mode === "clear-cache") {
      throw new Error(`参数 ${token} 仅可用于启动代理服务`);
    }
  };

  const readNext = (index: number, key: string): string => {
    const value = normalized[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`参数 ${key} 缺少值`);
    }
    return value;
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const token = normalized[index];
    if (!token) {
      continue;
    }

    if (token === "-h" || token === "--help") {
      flags.help = true;
      continue;
    }
    if (token === "-v" || token === "--version") {
      flags.version = true;
      continue;
    }
    if (token === "--no-banner") {
      ensureServeOnly(token);
      flags.noBanner = true;
      continue;
    }
    if (token === "-p" || token === "--port") {
      ensureServeOnly(token);
      flags.port = readNext(index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--port=")) {
      ensureServeOnly("--port");
      flags.port = token.slice("--port=".length);
      continue;
    }
    if (token === "-t" || token === "--target") {
      ensureServeOnly(token);
      flags.target = readNext(index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--target=")) {
      ensureServeOnly("--target");
      flags.target = token.slice("--target=".length);
      continue;
    }
    if (token === "-d" || token === "--data-dir") {
      flags.dataDir = readNext(index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--data-dir=")) {
      flags.dataDir = token.slice("--data-dir=".length);
      continue;
    }

    throw new Error(`未知参数: ${token}`);
  }

  return flags;
};

const resolveDataDir = (dataDirRaw?: string): string => {
  return resolve(dataDirRaw?.trim() || join(process.cwd(), ".proxira"));
};

const clearLocalCache = async (dataDirRaw?: string): Promise<void> => {
  const dataDir = resolveDataDir(dataDirRaw);
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  console.log(chalk.green(`[proxira] 本地缓存已清除：${dataDir}`));
};

const run = async (): Promise<void> => {
  try {
    const flags = parseFlags(process.argv.slice(2));

    if (flags.help) {
      printHelp();
      return;
    }
    if (flags.version) {
      console.log(CLI_VERSION);
      return;
    }
    if (flags.mode === "clear-cache") {
      await clearLocalCache(flags.dataDir);
      return;
    }

    if (flags.port) {
      process.env.PORT = flags.port;
    }
    if (flags.target) {
      process.env.PROXY_TARGET_URL = flags.target;
    }
    if (flags.dataDir) {
      process.env.PROXY_DATA_DIR = flags.dataDir;
    }
    if (flags.noBanner) {
      process.env.PROXY_DISABLE_BANNER = "1";
    }

    process.env.PROXY_CLI_MODE = "1";
    await import("./index.js");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`[proxira] ${message}`));
    console.error(chalk.gray("可执行 `proxira --help` 查看完整中文参数说明。"));
    process.exitCode = 1;
  }
};

void run();
