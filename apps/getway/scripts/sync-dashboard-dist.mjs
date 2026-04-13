import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "../../..");
const sourceDir = resolve(workspaceRoot, "apps/dashboard/dist");
const targetDir = resolve(workspaceRoot, "apps/getway/dashboard-dist");

if (!existsSync(sourceDir)) {
  console.error(
    "[proxira] dashboard build output not found. Run `pnpm --filter @proxira/dashboard build` first.",
  );
  process.exit(1);
}

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });

console.log(`[proxira] dashboard assets copied to ${targetDir}`);
