import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { FileSystemAdapter } from "../app/types.js";

export const createNodeFileSystem = (): FileSystemAdapter => {
  return {
    existsSync,
    async mkdir(path, options) {
      await mkdir(path, options);
    },
    async readTextFile(path) {
      return readFile(path, "utf8");
    },
    async readBinaryFile(path) {
      return new Uint8Array(await readFile(path));
    },
    async writeTextFile(path, data) {
      await writeFile(path, data, "utf8");
    },
  };
};
