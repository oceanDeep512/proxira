import type { FileSystemAdapter } from "../app/types.js";

// A half-written file used to be read back as "no data", and the next save
// would then overwrite the real history with an empty one. Keep the broken
// bytes around instead: evidence first, empty state second.
const quarantineCorruptFile = async (
  fs: FileSystemAdapter,
  filePath: string,
): Promise<void> => {
  try {
    await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`);
  } catch {
    // Best effort. If we cannot move it, the caller still sees null and will
    // not silently overwrite it with empty data during the next hydrate.
  }
};

export const readJsonFile = async <T>(
  fs: FileSystemAdapter,
  filePath: string,
): Promise<T | null> => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let payload: string;
  try {
    payload = await fs.readTextFile(filePath);
  } catch {
    await quarantineCorruptFile(fs, filePath);
    return null;
  }

  try {
    return JSON.parse(payload) as T;
  } catch {
    await quarantineCorruptFile(fs, filePath);
    return null;
  }
};

// Write a sibling temp file then rename: rename is atomic within a filesystem,
// so a crash or ENOSPC mid-write can only leave the temp file behind, never a
// truncated config.json / history.json.
export const saveJsonFile = async (
  fs: FileSystemAdapter,
  filePath: string,
  data: unknown,
): Promise<void> => {
  const payload = JSON.stringify(data, null, 2);
  const tempPath = `${filePath}.tmp`;
  try {
    await fs.writeTextFile(tempPath, payload);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.writeTextFile(filePath, payload);
    } catch {
      throw error;
    }
  }
};
