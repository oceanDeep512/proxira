#!/usr/bin/env node
import boxen from "boxen";
import chalk from "chalk";
import { readFileSync, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import { PROXIRA_LOGO_LINES } from "./logo.js";

type CliFlags = {
  mode: "serve" | "clear-cache" | "gen-cert";
  help: boolean;
  version: boolean;
  noBanner: boolean;
  noPrefix: boolean;
  port?: string;
  target?: string;
  dataDir?: string;
  prefix?: string;
  https: boolean;
  httpsKey?: string;
  httpsCert?: string;
  certOutputDir?: string;
  certCommonName?: string;
  certDays?: string;
  yes: boolean;
};

type OSType = "macos" | "windows" | "linux" | "unknown";

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

const detectOS = (): OSType => {
  const platform = process.platform;
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "unknown";
};

const checkOpenSSL = (): boolean => {
  try {
    const result = execSync("openssl version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
};

const checkHomebrew = (): boolean => {
  try {
    execSync("brew --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
};

const checkChocolatey = (): boolean => {
  try {
    execSync("choco --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
};

const checkApt = (): boolean => {
  try {
    execSync("apt-get --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
};

const getInstallCommand = (os: OSType): string | null => {
  switch (os) {
    case "macos":
      if (checkHomebrew()) {
        return "brew install openssl";
      }
      return null;
    case "windows":
      if (checkChocolatey()) {
        return "choco install openssl";
      }
      return null;
    case "linux":
      if (checkApt()) {
        return "sudo apt-get update && sudo apt-get install -y openssl";
      }
      return null;
    default:
      return null;
  }
};

const askConfirmation = async (message: string): Promise<boolean> => {
  console.log(chalk.yellow(message));
  console.log(chalk.gray("请按 Enter 继续，或 Ctrl+C 取消..."));

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const key = data.toString();
      if (key === "\u0003") {
        process.exit(1);
      }
      resolve(true);
    });
  });
};

const printHelp = (): void => {
  const logo = PROXIRA_LOGO_LINES.map((line, index) =>
    [chalk.cyanBright, chalk.blueBright, chalk.magentaBright][index % 3]!(line),
  ).join("\n");

  const usage = [
    logo,
    "",
    `${chalk.bold("描述")}`,
    "  轻量化实时请求代理工具 —— 让本地开发联调更高效",
    "",
    `${chalk.bold("版本")}`,
    `  ${CLI_VERSION}`,
    "",
    `${chalk.bold("用法")}`,
    "  proxira [command] [options]",
    "",
    `${chalk.bold("命令")}`,
    `  ${chalk.cyan("serve")}       ${chalk.gray("启动代理服务（默认）")}`,
    `  ${chalk.cyan("gen-cert")}    ${chalk.gray("生成自签名 HTTPS 证书")}`,
    `  ${chalk.cyan("clear-cache")} ${chalk.gray("清除本地缓存数据")}`,
    "",
    `${chalk.bold("选项")}`,
    "",
    `${chalk.bold("服务选项")}`,
    `  -p, --port <port>          ${chalk.gray("代理服务端口")} ${chalk.dim("(默认: 3000)")}`,
    `  -t, --target <url>         ${chalk.gray("上游服务地址")} ${chalk.dim("(默认: http://localhost:8080)")}`,
    `  -d, --data-dir <path>      ${chalk.gray("数据存储目录")} ${chalk.dim("(默认: ./.proxira)")}`,
    "",
    `${chalk.bold("代理选项")}`,
    `  -x, --prefix <path>        ${chalk.gray("自定义代理前缀")} ${chalk.dim("(默认: /proxira)")}`,
    `  -nx, --no-prefix           ${chalk.gray("关闭代理前缀，直接转发所有请求")}`,
    "",
    `${chalk.bold("HTTPS 选项")}`,
    `  -s, --https                ${chalk.gray("启用 HTTPS 服务模式")}`,
    `      --https-key <path>     ${chalk.gray("HTTPS 私钥文件路径")}`,
    `      --https-cert <path>    ${chalk.gray("HTTPS 证书文件路径")}`,
    "",
    `${chalk.bold("gen-cert 选项")}`,
    `  -o, --output-dir <path>    ${chalk.gray("证书输出目录")} ${chalk.dim("(默认: ./.proxira/certs)")}`,
    `  -c, --common-name <name>   ${chalk.gray("证书通用名")} ${chalk.dim("(默认: localhost)")}`,
    `      --days <number>        ${chalk.gray("证书有效期天数")} ${chalk.dim("(默认: 365)")}`,
    `  -y, --yes                  ${chalk.gray("跳过确认提示，直接执行")}`,
    "",
    `${chalk.bold("其他选项")}`,
    `  -b, --no-banner            ${chalk.gray("关闭启动 Banner")}`,
    `  -h, --help                 ${chalk.gray("显示此帮助信息")}`,
    `  -v, --version              ${chalk.gray("显示版本号")}`,
    "",
    `${chalk.bold("示例")}`,
    "",
    `${chalk.gray("# 启动代理服务")}`,
    `  proxira`,
    `  proxira --port 3010 --target http://localhost:8080`,
    "",
    `${chalk.gray("# 自定义代理前缀")}`,
    `  proxira --prefix /debug-proxy --target http://localhost:8080`,
    `  proxira --no-prefix --target http://localhost:8080`,
    "",
    `${chalk.gray("# HTTPS 模式（自动检测证书）")}`,
    `  proxira gen-cert`,
    `  proxira --https`,
    "",
    `${chalk.gray("# HTTPS 模式（手动指定证书）")}`,
    `  proxira --https --https-key ./key.pem --https-cert ./cert.pem`,
    "",
    `${chalk.gray("# 清除缓存")}`,
    `  proxira clear-cache`,
    "",
    `${chalk.bold("更多信息")}`,
    `  ${chalk.gray("文档:")} https://github.com/oceandeep512/proxira`,
    `  ${chalk.gray("问题:")} https://github.com/oceandeep512/proxira/issues`,
  ].join("\n");

  console.log(
    boxen(usage, {
      borderStyle: "round",
      borderColor: "cyan",
      padding: { top: 1, right: 2, bottom: 1, left: 2 },
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
    noPrefix: false,
    https: false,
    yes: false,
  };

  let normalized: string[];
  if (normalizedInput[0] === "clear-cache") {
    flags.mode = "clear-cache";
    normalized = normalizedInput.slice(1);
  } else if (normalizedInput[0] === "gen-cert") {
    flags.mode = "gen-cert";
    normalized = normalizedInput.slice(1);
  } else {
    flags.mode = "serve";
    normalized = normalizedInput;
  }

  const ensureServeOnly = (token: string): void => {
    if (flags.mode === "clear-cache" || flags.mode === "gen-cert") {
      throw new Error(`参数 ${token} 仅可用于启动代理服务`);
    }
  };

  const ensureGenCertOnly = (token: string): void => {
    if (flags.mode !== "gen-cert") {
      throw new Error(`参数 ${token} 仅可用于 gen-cert 子命令`);
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
    if (token === "-b" || token === "--no-banner") {
      ensureServeOnly(token);
      flags.noBanner = true;
      continue;
    }
    if (token === "-nx" || token === "--no-prefix") {
      ensureServeOnly(token);
      flags.noPrefix = true;
      continue;
    }
    if (token === "-s" || token === "--https") {
      ensureServeOnly(token);
      flags.https = true;
      continue;
    }
    if (token === "-y" || token === "--yes") {
      ensureGenCertOnly(token);
      flags.yes = true;
      continue;
    }
    if (token === "--https-key") {
      ensureServeOnly(token);
      flags.httpsKey = readNext(index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--https-key=")) {
      ensureServeOnly("--https-key");
      flags.httpsKey = token.slice("--https-key=".length);
      continue;
    }
    if (token === "--https-cert") {
      ensureServeOnly(token);
      flags.httpsCert = readNext(index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--https-cert=")) {
      ensureServeOnly("--https-cert");
      flags.httpsCert = token.slice("--https-cert=".length);
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
    if (token === "-x" || token === "--prefix") {
      ensureServeOnly(token);
      flags.prefix = readNext(index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--prefix=")) {
      ensureServeOnly("--prefix");
      flags.prefix = token.slice("--prefix=".length);
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

    if (flags.mode === "gen-cert") {
      if (token === "-o" || token === "--output-dir") {
        flags.certOutputDir = readNext(index, token);
        index += 1;
        continue;
      }
      if (token.startsWith("--output-dir=")) {
        flags.certOutputDir = token.slice("--output-dir=".length);
        continue;
      }
      if (token === "-c" || token === "--common-name") {
        flags.certCommonName = readNext(index, token);
        index += 1;
        continue;
      }
      if (token.startsWith("--common-name=")) {
        flags.certCommonName = token.slice("--common-name=".length);
        continue;
      }
      if (token === "--days") {
        flags.certDays = readNext(index, token);
        index += 1;
        continue;
      }
      if (token.startsWith("--days=")) {
        flags.certDays = token.slice("--days=".length);
        continue;
      }
    }

    throw new Error(`未知参数: ${token}`);
  }

  if (flags.noPrefix && flags.prefix !== undefined) {
    throw new Error("不能同时传递 --no-prefix 和 --prefix");
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

const generateCertificate = async (
  outputDirRaw?: string,
  commonNameRaw?: string,
  daysRaw?: string,
  skipConfirmation: boolean = false,
): Promise<{ keyPath: string; certPath: string }> => {
  const outputDir = resolve(
    outputDirRaw?.trim() || join(process.cwd(), ".proxira", "certs"),
  );
  const commonName = commonNameRaw?.trim() || "localhost";
  const days = daysRaw ? Number(daysRaw) : 365;

  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("证书有效期天数必须是正整数");
  }

  const os = detectOS();
  const hasOpenSSL = checkOpenSSL();

  console.log(
    chalk.cyan(
      "╔════════════════════════════════════════════════════════════╗",
    ),
  );
  console.log(
    chalk.cyan(
      "║           Proxira 证书生成向导                               ║",
    ),
  );
  console.log(
    chalk.cyan(
      "╚════════════════════════════════════════════════════════════╝",
    ),
  );
  console.log("");

  console.log(chalk.bold("环境检测："));
  const osLabel = {
    macos: "macOS",
    windows: "Windows",
    linux: "Linux",
    unknown: "Unknown",
  }[os];
  console.log(`  - 操作系统：${chalk.cyan(osLabel)}`);
  console.log(
    `  - OpenSSL：${hasOpenSSL ? chalk.green("已安装") : chalk.red("未安装")}`,
  );
  console.log("");

  if (!hasOpenSSL) {
    console.log(chalk.yellow("⚠️  检测到 OpenSSL 未安装"));
    console.log("");

    const installCommand = getInstallCommand(os);
    const installGuide = {
      macos: [
        "方式一（推荐）：使用 Homebrew 安装",
        "  brew install openssl",
        "",
        "方式二：从官网下载安装",
        "  访问 https://www.openssl.org/ 下载并安装",
      ],
      windows: [
        "方式一（推荐）：使用 Chocolatey 安装",
        "  choco install openssl",
        "",
        "方式二：从官网下载安装",
        "  访问 https://slproweb.com/products/Win32OpenSSL.html 下载并安装",
        "  安装后记得将 OpenSSL 添加到系统 PATH 环境变量",
      ],
      linux: [
        "方式一（推荐）：使用包管理器安装",
        "  Ubuntu/Debian: sudo apt-get install openssl",
        "  CentOS/RHEL: sudo yum install openssl",
        "  Arch Linux: sudo pacman -S openssl",
        "",
        "方式二：从源码编译安装",
        "  访问 https://www.openssl.org/ 下载源码编译",
      ],
      unknown: ["请访问 https://www.openssl.org/ 下载并安装 OpenSSL"],
    }[os];

    if (installCommand) {
      console.log(chalk.cyan("📦 推荐一键安装命令："));
      console.log(chalk.yellow(`  ${installCommand}`));
      console.log("");
    }

    console.log(chalk.cyan("📖 详细安装指南："));
    installGuide.forEach((line) => console.log(`  ${line}`));
    console.log("");

    console.log(chalk.gray("安装完成后，请重新运行：proxira gen-cert"));
    throw new Error("OpenSSL 未安装，请先安装 OpenSSL");
  }

  await mkdir(outputDir, { recursive: true });
  const keyPath = join(outputDir, "key.pem");
  const certPath = join(outputDir, "cert.pem");

  if (existsSync(keyPath) || existsSync(certPath)) {
    console.log(chalk.yellow(`⚠️  证书文件已存在：`));
    console.log(chalk.gray(`  - ${keyPath}`));
    console.log(chalk.gray(`  - ${certPath}`));
    console.log(chalk.yellow(`如要重新生成，请先删除上述文件。`));
    return { keyPath, certPath };
  }

  console.log(chalk.bold("证书配置："));
  console.log(`  - 输出目录：${chalk.cyan(outputDir)}`);
  console.log(`  - 通用名：${chalk.cyan(commonName)}`);
  console.log(`  - 有效期：${chalk.cyan(`${days} 天`)}`);
  console.log("");

  if (!skipConfirmation) {
    console.log(chalk.bold("即将生成自签名证书，用于本地开发测试。"));
    console.log(
      chalk.gray("注意：自签名证书在浏览器中会显示安全警告，这是正常的。"),
    );
    console.log("");
    await askConfirmation("按 Enter 继续生成证书...");
    console.log("");
  }

  console.log(chalk.cyan("🔐 正在生成证书..."));
  console.log("");

  return new Promise((resolveCert, reject) => {
    const openssl = spawn("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:4096",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      String(days),
      "-nodes",
      "-subj",
      `/CN=${commonName}`,
    ]);

    let stderr = "";
    openssl.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    openssl.on("close", (code) => {
      if (code === 0) {
        console.log(chalk.green("✅ 证书生成成功！"));
        console.log("");
        console.log(chalk.bold("证书文件："));
        console.log(chalk.cyan(`  - 私钥：${keyPath}`));
        console.log(chalk.cyan(`  - 证书：${certPath}`));
        console.log("");
        console.log(chalk.bold("快速启动 HTTPS 服务："));
        console.log(
          chalk.gray(
            `  proxira --https --https-key "${keyPath}" --https-cert "${certPath}"`,
          ),
        );
        console.log("");
        console.log(
          chalk.cyan(
            "╔════════════════════════════════════════════════════════════╗",
          ),
        );
        console.log(
          chalk.cyan(
            "║  使用说明：                                                  ║",
          ),
        );
        console.log(
          chalk.cyan(
            "║  1. 浏览器访问时会显示安全警告，点击「高级」→「继续访问」  ║",
          ),
        );
        console.log(
          chalk.cyan(
            "║  2. 此证书仅用于本地开发，请勿用于生产环境                  ║",
          ),
        );
        console.log(
          chalk.cyan(
            "╚════════════════════════════════════════════════════════════╝",
          ),
        );
        resolveCert({ keyPath, certPath });
      } else {
        console.error(chalk.red(`❌ OpenSSL 执行失败 (exit code ${code})`));
        if (stderr) {
          console.error(chalk.gray(stderr));
        }
        reject(new Error("证书生成失败"));
      }
    });

    openssl.on("error", (err) => {
      console.error(chalk.red(`❌ 无法执行 OpenSSL：${err.message}`));
      reject(err);
    });
  });
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
    if (flags.mode === "gen-cert") {
      await generateCertificate(
        flags.certOutputDir,
        flags.certCommonName,
        flags.certDays,
        flags.yes,
      );
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
    if (flags.noPrefix) {
      process.env.PROXY_PREFIX_ENABLED = "0";
    }
    if (flags.prefix) {
      process.env.PROXY_PREFIX = flags.prefix;
    }
    if (flags.noBanner) {
      process.env.PROXY_DISABLE_BANNER = "1";
    }

    if (flags.https) {
      process.env.PROXY_HTTPS_ENABLED = "1";

      let keyPath = flags.httpsKey;
      let certPath = flags.httpsCert;

      // 如果用户没有指定证书路径，尝试自动检测默认位置
      if (!keyPath || !certPath) {
        const defaultDataDir = flags.dataDir
          ? resolve(flags.dataDir)
          : join(process.cwd(), ".proxira");
        const defaultCertDir = join(defaultDataDir, "certs");
        const defaultKeyPath = join(defaultCertDir, "key.pem");
        const defaultCertPath = join(defaultCertDir, "cert.pem");

        if (existsSync(defaultKeyPath) && existsSync(defaultCertPath)) {
          if (!flags.noBanner) {
            console.log(chalk.cyan(`[proxira] 检测到默认证书，自动加载：`));
            console.log(chalk.gray(`  - 私钥：${defaultKeyPath}`));
            console.log(chalk.gray(`  - 证书：${defaultCertPath}`));
            console.log("");
          }
          if (!keyPath) {
            keyPath = defaultKeyPath;
          }
          if (!certPath) {
            certPath = defaultCertPath;
          }
        } else {
          // 证书不存在，询问用户是否生成
          console.log(chalk.yellow(`[proxira] 未检测到 HTTPS 证书`));
          console.log("");

          const certOutputDir = flags.dataDir
            ? join(resolve(flags.dataDir), "certs")
            : undefined;

          await askConfirmation("是否现在生成自签名证书？");
          console.log("");

          const certResult = await generateCertificate(
            certOutputDir,
            undefined,
            undefined,
            true,
          );
          keyPath = certResult.keyPath;
          certPath = certResult.certPath;
          console.log("");
        }
      }

      // 验证证书路径
      if (!keyPath || !certPath) {
        throw new Error(
          "HTTPS 模式需要提供证书路径。\n" +
          "方式 1：先生成证书，再启动服务\n" +
          "  proxira gen-cert\n" +
          "  proxira --https\n" +
          "方式 2：直接指定证书路径\n" +
          "  proxira --https --https-key ./key.pem --https-cert ./cert.pem",
        );
      }

      process.env.PROXY_HTTPS_KEY_PATH = keyPath;
      process.env.PROXY_HTTPS_CERT_PATH = certPath;
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
