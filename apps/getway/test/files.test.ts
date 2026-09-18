import { describe, expect, it } from "vitest";
import { readJsonFile, saveJsonFile } from "../src/shared/files.js";
import { MemoryFileSystem } from "./helpers.js";

describe("saveJsonFile / readJsonFile", () => {
  it("writes through a temp file and renames, never leaving a half file behind", async () => {
    const fs = new MemoryFileSystem();
    await saveJsonFile(fs, "/data/history.json", { hello: "world" });

    // The rename is what makes the swap atomic; a direct overwrite would leave
    // a truncated file if the process died mid-write.
    expect(fs.files.has("/data/history.json.tmp")).toBe(false);
    expect(fs.files.get("/data/history.json")).toBe(
      JSON.stringify({ hello: "world" }, null, 2),
    );
    expect(await readJsonFile<{ hello: string }>(fs, "/data/history.json")).toEqual({
      hello: "world",
    });
  });

  it("quarantines a corrupt file instead of reporting it as empty", async () => {
    const fs = new MemoryFileSystem({ "/data/history.json": "{ not json" });

    // Returning null used to make the next save overwrite the only copy of the
    // real history with empty data.
    expect(await readJsonFile(fs, "/data/history.json")).toBeNull();

    const quarantined = [...fs.files.keys()].filter((key) =>
      key.startsWith("/data/history.json.corrupt-"),
    );
    expect(quarantined).toHaveLength(1);
    expect(fs.files.get(quarantined[0]!)).toBe("{ not json");
  });

  it("leaves an unreadable payload in place too", async () => {
    const fs = new MemoryFileSystem({ "/data/config.json": "{}" });
    fs.readTextFile = async () => {
      throw new Error("EACCES");
    };

    expect(await readJsonFile(fs, "/data/config.json")).toBeNull();
    const quarantined = [...fs.files.keys()].filter((key) =>
      key.startsWith("/data/config.json.corrupt-"),
    );
    expect(quarantined).toHaveLength(1);
  });

  it("returns null for a missing file without quarantining anything", async () => {
    const fs = new MemoryFileSystem();
    expect(await readJsonFile(fs, "/data/nope.json")).toBeNull();
    expect(fs.files.size).toBe(0);
  });
});
