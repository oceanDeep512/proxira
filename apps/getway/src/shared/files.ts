import type { FileSystemAdapter } from "../app/types.js";

export const readJsonFile = async <T>(
  fs: FileSystemAdapter,
  filePath: string,
): Promise<T | null> => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const payload = await fs.readTextFile(filePath);
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
};

export const saveJsonFile = async (
  fs: FileSystemAdapter,
  filePath: string,
  data: unknown,
): Promise<void> => {
  const payload = JSON.stringify(data, null, 2);
  await fs.writeTextFile(filePath, payload);
};
