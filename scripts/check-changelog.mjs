#!/usr/bin/env node
/**
 * 校验「官网更新日志」里有没有当前版本这一条。
 *
 * 为什么要有这个脚本：更新日志的唯一归宿是官网（apps/web/src/data/changelog.ts），
 * 仓库里不再维护第二份 CHANGELOG.md。没有守卫的话，一次「忘了写」就会让官网悄悄落后一个版本，
 * 而且只有用户去翻更新日志页才会发现。所以把它挂在 publish:npm 前面 —— 忘了写就发不出去。
 *
 * 用法：pnpm run check:changelog
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = resolve(root, "apps/getway/package.json");
const changelogPath = resolve(root, "apps/web/src/data/changelog.ts");

const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
const source = readFileSync(changelogPath, "utf8");

/** 取 releases 数组里的 version，按出现顺序（最新的写在最前面） */
const versions = [...source.matchAll(/^\s*version:\s*"([^"]+)",\s*$/gm)].map((m) => m[1]);

if (versions.length === 0) {
  console.error(`✗ 在 ${changelogPath} 里没读到任何版本条目，文件结构可能变了。`);
  process.exit(1);
}

if (versions[0] !== version) {
  const hasIt = versions.includes(version);
  console.error(
    [
      `✗ 官网更新日志与当前版本对不上：package.json 是 ${version}，更新日志最新一条是 ${versions[0]}。`,
      hasIt
        ? `  ${version} 的条目存在但不在最前面 —— 数组要求新的在前。`
        : `  缺少 ${version} 的条目。`,
      "",
      "  发版流程（缺哪步补哪步）：",
      "    1) pnpm run bump:minor          # 或 bump:patch / bump:major，只升版本号",
      "    2) pnpm run changelog:draft     # 从本次提交生成草稿条目",
      "    3) 手改 summary 与各条文案（提交信息是给开发者看的，未必用户能读懂）",
      "    4) git add -A && git commit && git push   # 官网随之更新",
      "    5) pnpm run publish:npm",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`✓ 更新日志已包含 v${version}（共 ${versions.length} 个版本条目）`);
