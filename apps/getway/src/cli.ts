#!/usr/bin/env node
import boxen from "boxen";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROXIRA_LOGO_LINES } from "./logo.js";

type CliFlags = {
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
    `${chalk.bold("Proxira CLI")}`,
    "",
    `${chalk.bold("Usage")}`,
    "  proxira [start] [options]",
    "",
    `${chalk.bold("Options")}`,
    "  -p, --port <port>          Proxy service port (default: 3000)",
    "  -t, --target <url>         Upstream target base URL",
    "  -d, --data-dir <path>      Data directory for config file",
    "      --no-banner            Disable fancy startup banner",
    "  -h, --help                 Show this help",
    "  -v, --version              Show CLI version",
    "",
    `${chalk.bold("Examples")}`,
    "  proxira",
    "  proxira --port 3010 --target http://localhost:8080",
    "  proxira start -p 3001 -d ./.proxira",
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
  const normalized = (argv[0] === "start" ? argv.slice(1) : argv).filter(
    (token) => token !== "--",
  );
  const flags: CliFlags = {
    help: false,
    version: false,
    noBanner: false,
  };

  const readNext = (index: number, key: string): string => {
    const value = normalized[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${key}`);
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
      flags.noBanner = true;
      continue;
    }
    if (token === "-p" || token === "--port") {
      flags.port = readNext(index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--port=")) {
      flags.port = token.slice("--port=".length);
      continue;
    }
    if (token === "-t" || token === "--target") {
      flags.target = readNext(index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--target=")) {
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

    throw new Error(`Unknown option: ${token}`);
  }

  return flags;
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
    console.error(chalk.gray("Run `proxira --help` to inspect available options."));
    process.exitCode = 1;
  }
};

void run();
