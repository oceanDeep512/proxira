import { describe, expect, it } from "vitest";
import {
  APP_NAME,
  describeDataDirSource,
  findLegacyDataDir,
  instanceFilePath,
  readActiveInstance,
  resolveDataDir,
  resolveUserDataDir,
} from "../src/config/data-dir.js";
import { MemoryFileSystem } from "./helpers.js";

const HOME = "/home/tester";
const CWD_A = "/tmp/proxira-cwd-a";
const CWD_B = "/tmp/proxira-cwd-b";

describe("data-dir", () => {
  describe("resolveUserDataDir", () => {
    it("uses Library/Application Support on darwin", () => {
      expect(resolveUserDataDir({}, HOME, "darwin")).toBe(
        `${HOME}/Library/Application Support/${APP_NAME}`,
      );
    });

    it("uses APPDATA on win32 when set", () => {
      // join() runs with the host's path module (posix in CI), so separators
      // are always "/" here — the assertion targets the chosen base directory.
      expect(
        resolveUserDataDir({ APPDATA: "D:\\AppData" }, HOME, "win32"),
      ).toBe(`D:\\AppData/${APP_NAME}`);
    });

    it("falls back to AppData/Roaming on win32 without APPDATA", () => {
      expect(resolveUserDataDir({}, HOME, "win32")).toBe(
        `${HOME}/AppData/Roaming/${APP_NAME}`,
      );
    });

    it("ignores whitespace-only APPDATA", () => {
      expect(resolveUserDataDir({ APPDATA: "   " }, HOME, "win32")).toBe(
        `${HOME}/AppData/Roaming/${APP_NAME}`,
      );
    });

    it("uses XDG_DATA_HOME on linux when set", () => {
      expect(
        resolveUserDataDir({ XDG_DATA_HOME: "/xdg/data" }, HOME, "linux"),
      ).toBe(`/xdg/data/${APP_NAME}`);
    });

    it("falls back to ~/.local/share on linux without XDG_DATA_HOME", () => {
      expect(resolveUserDataDir({}, HOME, "linux")).toBe(
        `${HOME}/.local/share/${APP_NAME}`,
      );
    });
  });

  describe("resolveDataDir priority", () => {
    it("prefers the --data-dir flag over everything", () => {
      const result = resolveDataDir({
        flag: "/explicit/dir",
        env: { PROXY_DATA_DIR: "/env/dir" },
        home: HOME,
        platform: "linux",
        cwd: CWD_A,
      });
      expect(result).toEqual({ dataDir: "/explicit/dir", source: "flag" });
    });

    it("prefers PROXY_DATA_DIR over the user default", () => {
      const result = resolveDataDir({
        env: { PROXY_DATA_DIR: "/env/dir" },
        home: HOME,
        platform: "linux",
        cwd: CWD_A,
      });
      expect(result).toEqual({ dataDir: "/env/dir", source: "env" });
    });

    it("falls back to the user-level default", () => {
      const result = resolveDataDir({
        env: {},
        home: HOME,
        platform: "darwin",
        cwd: CWD_A,
      });
      expect(result).toEqual({
        dataDir: `${HOME}/Library/Application Support/${APP_NAME}`,
        source: "user",
      });
    });

    it("ignores empty / whitespace-only flag and env values", () => {
      const result = resolveDataDir({
        flag: "   ",
        env: { PROXY_DATA_DIR: "  " },
        home: HOME,
        platform: "linux",
        cwd: CWD_A,
      });
      expect(result.source).toBe("user");
    });

    it("resolves a relative flag against cwd", () => {
      const result = resolveDataDir({
        flag: ".proxira",
        env: {},
        cwd: CWD_A,
      });
      expect(result.dataDir).toBe(`${CWD_A}/.proxira`);
    });
  });

  describe("cwd independence (regression)", () => {
    // The original bug: the default used to be `<cwd>/.proxira`, so every
    // working directory silently got its own history. The default must now be
    // identical no matter where the process was launched from.
    it("resolves the same default directory from any cwd", () => {
      const fromA = resolveDataDir({ env: {}, home: HOME, platform: "darwin", cwd: CWD_A });
      const fromB = resolveDataDir({ env: {}, home: HOME, platform: "darwin", cwd: CWD_B });
      expect(fromA).toEqual(fromB);
    });

    it("resolves the same directory when only the port differs (no port input at all)", () => {
      // Port is not part of resolveDataDir's inputs — this test documents it.
      const result = resolveDataDir({ env: {}, home: HOME, platform: "linux" });
      expect(result.dataDir).toBe(`${HOME}/.local/share/${APP_NAME}`);
    });
  });

  describe("describeDataDirSource", () => {
    it("labels each source in Chinese for the startup banner", () => {
      expect(describeDataDirSource("flag")).toBe("--data-dir 参数");
      expect(describeDataDirSource("env")).toBe("PROXY_DATA_DIR 环境变量");
      expect(describeDataDirSource("user")).toBe("用户级默认目录");
    });
  });

  describe("findLegacyDataDir", () => {
    it("returns null when no legacy directory exists", () => {
      const fs = new MemoryFileSystem();
      expect(findLegacyDataDir(CWD_A, fs)).toBeNull();
    });

    it("returns null when .proxira exists but holds no data files", () => {
      const fs = new MemoryFileSystem({
        [`${CWD_A}/.proxira/README.txt`]: "empty",
      });
      expect(findLegacyDataDir(CWD_A, fs)).toBeNull();
    });

    it("detects each of the data markers", () => {
      for (const marker of ["config.json", "history.json", "rules.json"]) {
        const fs = new MemoryFileSystem({
          [`${CWD_A}/.proxira/${marker}`]: "{}",
        });
        expect(findLegacyDataDir(CWD_A, fs)).toBe(`${CWD_A}/.proxira`);
      }
    });
  });

  describe("readActiveInstance", () => {
    const fileFor = (dataDir: string) => instanceFilePath(dataDir);

    it("returns null when instance.json does not exist", async () => {
      const fs = new MemoryFileSystem();
      await expect(readActiveInstance(CWD_A, fs)).resolves.toBeNull();
    });

    it("returns instance info while the pid is alive", async () => {
      const info = { pid: process.pid, port: 3000, startedAt: "2026-09-15T00:00:00.000Z" };
      const fs = new MemoryFileSystem({
        [fileFor(CWD_A)]: JSON.stringify(info),
      });
      await expect(readActiveInstance(CWD_A, fs)).resolves.toEqual(info);
    });

    it("returns null for a dead pid", async () => {
      const fs = new MemoryFileSystem({
        [fileFor(CWD_A)]: JSON.stringify({
          pid: 2_000_000_000, // assumes no such process in the test env
          port: 3000,
          startedAt: "2026-09-15T00:00:00.000Z",
        }),
      });
      await expect(readActiveInstance(CWD_A, fs)).resolves.toBeNull();
    });

    it("returns null for invalid pid values", async () => {
      for (const pid of [0, -1, "999", null]) {
        const fs = new MemoryFileSystem({
          [fileFor(CWD_A)]: JSON.stringify({ pid, port: 3000 }),
        });
        await expect(readActiveInstance(CWD_A, fs)).resolves.toBeNull();
      }
    });

    it("returns null on malformed JSON", async () => {
      const fs = new MemoryFileSystem({ [fileFor(CWD_A)]: "not json" });
      await expect(readActiveInstance(CWD_A, fs)).resolves.toBeNull();
    });

    it("fills missing fields defensively", async () => {
      const fs = new MemoryFileSystem({
        [fileFor(CWD_A)]: JSON.stringify({ pid: process.pid }),
      });
      await expect(readActiveInstance(CWD_A, fs)).resolves.toEqual({
        pid: process.pid,
        port: 0,
        startedAt: "",
      });
    });
  });
});
