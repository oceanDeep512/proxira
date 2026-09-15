import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import type { FileSystemAdapter } from "../app/types.js";

export const APP_NAME = "Proxira";

/**
 * Which rule produced the data directory. Shown at startup so it is always
 * obvious where history is being written — a previous default derived the
 * directory from `process.cwd()`, which silently gave every working directory
 * its own separate history.
 */
export type DataDirSource = "flag" | "env" | "user";

export type DataDirResolution = {
  dataDir: string;
  source: DataDirSource;
};

// Per-platform default. Kept out of the repository tree on purpose: data must
// survive switching ports, launch styles and working directories.
export const resolveUserDataDir = (
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platformName: string = platform(),
): string => {
  if (platformName === "darwin") {
    return join(home, "Library", "Application Support", APP_NAME);
  }
  if (platformName === "win32") {
    const appData = env.APPDATA?.trim();
    return join(
      appData && appData.length > 0 ? appData : join(home, "AppData", "Roaming"),
      APP_NAME,
    );
  }
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  return join(
    xdgDataHome && xdgDataHome.length > 0
      ? xdgDataHome
      : join(home, ".local", "share"),
    APP_NAME,
  );
};

const firstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
};

/**
 * Single source of truth for the data directory.
 *
 * Order: explicit flag > PROXY_DATA_DIR > per-user default. A relative path is
 * resolved against `cwd` (the only place `cwd` is allowed to matter) so
 * `--data-dir .proxira` still means "next to where I launched".
 */
export const resolveDataDir = (
  options: {
    flag?: string | undefined;
    env?: NodeJS.ProcessEnv;
    home?: string;
    platform?: string;
    cwd?: string;
  } = {},
): DataDirResolution => {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const fromFlag = firstNonEmpty(options.flag);
  if (fromFlag) {
    return { dataDir: resolve(cwd, fromFlag), source: "flag" };
  }

  const fromEnv = firstNonEmpty(env.PROXY_DATA_DIR);
  if (fromEnv) {
    return { dataDir: resolve(cwd, fromEnv), source: "env" };
  }

  return {
    dataDir: resolveUserDataDir(env, options.home, options.platform),
    source: "user",
  };
};

export const describeDataDirSource = (source: DataDirSource): string => {
  if (source === "flag") {
    return "--data-dir 参数";
  }
  if (source === "env") {
    return "PROXY_DATA_DIR 环境变量";
  }
  return "用户级默认目录";
};

export const LEGACY_DIR_NAME = ".proxira";

const LEGACY_MARKERS = ["config.json", "history.json", "rules.json"] as const;

/**
 * Older releases wrote to `<cwd>/.proxira`. Detect one so the user can be told
 * where their previous history went instead of concluding it was lost.
 */
export const findLegacyDataDir = (
  cwd: string,
  fs: Pick<FileSystemAdapter, "existsSync">,
): string | null => {
  const legacy = join(cwd, LEGACY_DIR_NAME);
  const hasData = LEGACY_MARKERS.some((marker) =>
    fs.existsSync(join(legacy, marker)),
  );
  return hasData ? legacy : null;
};

export type InstanceInfo = {
  pid: number;
  port: number;
  startedAt: string;
};

export const instanceFilePath = (dataDir: string): string =>
  join(dataDir, "instance.json");

const isPidAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    // Signal 0 only probes for existence; it never delivers a signal.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * With a shared data directory two concurrent instances would overwrite each
 * other's config/history files, so surface the conflict instead of letting the
 * user debug missing records.
 */
export const readActiveInstance = async (
  dataDir: string,
  fs: Pick<FileSystemAdapter, "existsSync" | "readTextFile">,
): Promise<InstanceInfo | null> => {
  const file = instanceFilePath(dataDir);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const raw = JSON.parse(await fs.readTextFile(file)) as Partial<InstanceInfo>;
    const pid = typeof raw.pid === "number" ? raw.pid : 0;
    const port = typeof raw.port === "number" ? raw.port : 0;
    if (!isPidAlive(pid)) {
      return null;
    }
    return {
      pid,
      port,
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : "",
    };
  } catch {
    return null;
  }
};
