#!/usr/bin/env node
/**
 * 从 git 提交生成一条「官网更新日志」草稿，插到 apps/web/src/data/changelog.ts 顶部。
 *
 * 用法：
 *   pnpm run bump:minor          # 先把版本号升到要发的那个（脚本按 package.json 取版本）
 *   pnpm run changelog:draft     # 生成草稿
 *   node scripts/changelog-draft.mjs --dry-run   # 只看草稿，不写文件
 *
 * 为什么只生成「草稿」而不是直接定稿：提交信息是写给开发者的（含 chore/docs/refactor 这类内部改动），
 * 更新日志是写给用户的。机器分组保证不漏，文案必须人过一遍。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = resolve(root, "apps/getway/package.json");
const changelogPath = resolve(root, "apps/web/src/data/changelog.ts");

const dryRun = process.argv.includes("--dry-run");

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

// ---- 版本 ----------------------------------------------------------------
const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
const source = readFileSync(changelogPath, "utf8");
const versions = [...source.matchAll(/^\s*version:\s*"([^"]+)",\s*$/gm)].map((m) => m[1]);

if (versions.includes(version)) {
  console.error(
    [
      `✗ 更新日志里已经有 ${version} 的条目了。`,
      "  要重写就先删掉那一条；版本号还没升的话先跑 pnpm run bump:minor。",
      "  只想看看会生成什么：node scripts/changelog-draft.mjs --dry-run（同样会被这里挡住，",
      "  临时改版本号或删条目后再跑）。",
    ].join("\n"),
  );
  process.exit(1);
}

const prevVersion = versions[0];

// ---- 找上次发版的锚点提交 --------------------------------------------------
let range = null;
try {
  const anchor = git("log", "--format=%H", "-n", "1", "--grep", `release proxira v${prevVersion}`);
  if (anchor) range = `${anchor}..HEAD`;
} catch {
  /* 找不到就退回最近若干提交 */
}

if (!range) {
  console.warn(
    `! 没找到 v${prevVersion} 的发版提交，退回「最近 100 条提交」作为范围，请自行确认边界。`,
  );
}

const logArgs = ["log", "--no-merges", "--format=%s"];
if (range) logArgs.push(range);
else logArgs.push("-n", "100");

const subjects = git(...logArgs)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !/^chore(\([^)]*\))?:\s*release\b/i.test(line))
  .filter((line) => !/^Merge\b/.test(line));

// ---- 按 conventional commit 前缀粗分组 -------------------------------------
// 新增 = feat，修复 = fix，其余（chore/docs/refactor/perf/test/style/ci/无前缀）先塞进「变更」，
// 让人工过一遍时决定留还是删。
const KIND_BY_TYPE = {
  feat: "新增",
  fix: "修复",
  perf: "变更",
  refactor: "变更",
  chore: "变更",
  docs: "变更",
  test: "变更",
  style: "变更",
  build: "变更",
  ci: "变更",
};

const buckets = { 新增: [], 修复: [], 变更: [] };
let internalCount = 0;
let skippedCount = 0;

for (const raw of subjects) {
  const m = raw.match(/^([a-zA-Z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/);
  const type = m ? m[1].toLowerCase() : null;
  const text = m ? m[3].trim() : raw;

  let kind = KIND_BY_TYPE[type] ?? "变更";
  if (!m || !["feat", "fix"].includes(type)) internalCount += 1;

  if (!buckets[kind].includes(text)) buckets[kind].push(text);
}

// ---- 拼 TS 片段 ------------------------------------------------------------
const today = new Date();
const date = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0"),
].join("-");

// 一条都没解析出来（例如两次发版之间只有发版提交）时给个占位，避免生成空的 groups 数组
if (subjects.length === 0) {
  buckets.变更.push("（两次发版之间没解析出可用条目，请手写本版重点）");
  skippedCount += 1;
}

const lines = [];
lines.push("  {");
lines.push(`    version: ${JSON.stringify(version)},`);
lines.push(`    date: ${JSON.stringify(date)},`);
lines.push(`    summary: "一句话概括这个版本的重点（务必手改）",`);
lines.push("    groups: [");

for (const kind of ["新增", "变更", "修复"]) {
  const items = buckets[kind];
  if (items.length === 0) continue;
  lines.push("      {");
  lines.push(`        kind: ${JSON.stringify(kind)},`);
  lines.push("        items: [");
  for (const item of items) lines.push(`          ${JSON.stringify(item)},`);
  lines.push("        ],");
  lines.push("      },");
}

lines.push("    ],");
lines.push("  },");
const block = lines.join("\n");

// ---- 插入到 releases 数组最前面 --------------------------------------------
const anchorRe = /(export const releases: Release\[\] = \[\n)/;
if (!anchorRe.test(source)) {
  console.error("✗ 没在 changelog.ts 里找到 releases 数组的起点，请手动粘贴下面这段：\n");
  console.log(block);
  process.exit(1);
}

const next = source.replace(anchorRe, (_, at) => `${at}${block}\n`);

if (dryRun) {
  console.log(`— 草稿（--dry-run，未写入）— 共 ${subjects.length} 条提交 →\n`);
  console.log(block);
  process.exit(0);
}

writeFileSync(changelogPath, next, "utf8");

console.log(
  [
    `✓ 已把 v${version}（${date}）的草稿插到 ${changelogPath.replace(`${root}/`, "")} 顶部`,
    `  提交 ${subjects.length} 条 → 新增 ${buckets.新增.length} / 变更 ${buckets.变更.length} / 修复 ${buckets.修复.length}`,
    ...(internalCount > 0
      ? [`  ⚠ 其中 ${internalCount} 条不是 feat/fix（chore/docs/refactor 等），是内部改动，请删掉别给用户看`]
      : []),
    "  下一步：手改 summary 与各条文案 → pnpm run check:changelog → 提交推送",
  ].join("\n"),
);
