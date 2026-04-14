import boxen from "boxen";
import chalk from "chalk";
import type { RuntimeConfig } from "./types.js";
import { DashboardAssets } from "../dashboard/assets.js";
import { PROXIRA_LOGO_LINES } from "../logo.js";

export const printStartupInfo = (options: {
  config: RuntimeConfig;
  dashboard: DashboardAssets;
  port: number;
  targetBaseUrl: string;
  historyLimit: number;
  effectiveHistoryPersistLimit: number;
}): void => {
  const {
    config,
    dashboard,
    port,
    targetBaseUrl,
    historyLimit,
    effectiveHistoryPersistLimit,
  } = options;
  const protocol = config.httpsEnabled ? "https" : "http";
  const proxyUrl = `${protocol}://localhost:${port}`;
  const proxyEntryUrl = config.proxyPrefixEnabled
    ? `${proxyUrl}${config.proxyPrefix}`
    : proxyUrl;
  const dashboardUrl = `${protocol}://localhost:${port}${config.internalRoutePrefix}/ui`;
  const proxyModeLabel = config.proxyPrefixEnabled
    ? config.proxyPrefix
    : "disabled";
  const httpsModeLabel = config.httpsEnabled ? "enabled" : "disabled";

  if (config.disableStartupBanner) {
    console.log(`代理服务已启动：${proxyUrl}`);
    console.log(`代理入口：${proxyEntryUrl}`);
    console.log(`代理前缀：${proxyModeLabel}`);
    console.log(`HTTPS 模式：${httpsModeLabel}`);
    console.log(`当前上游地址：${targetBaseUrl}`);
    console.log(`数据目录：${config.dataDir}`);
    console.log(`历史记录上限：${historyLimit}`);
    console.log(`本地持久化最近条数：${effectiveHistoryPersistLimit}`);
    if (dashboard.dashboardDistDir) {
      console.log(`管理面板：${dashboardUrl}`);
    } else {
      console.log(
        "未检测到管理面板构建产物，请先执行 `pnpm --filter @proxira/dashboard build`。",
      );
    }
    printStartupTips(config, proxyEntryUrl, dashboardUrl, targetBaseUrl);
    return;
  }

  const logo = PROXIRA_LOGO_LINES.map((line, index) =>
    [chalk.cyanBright, chalk.blueBright, chalk.magentaBright][index % 3]!(line),
  ).join("\n");

  const summary = [
    logo,
    "",
    `${chalk.bold("Proxy")}: ${chalk.cyan(proxyEntryUrl)}`,
    `${chalk.bold("Prefix")}: ${chalk.gray(proxyModeLabel)}`,
    `${chalk.bold("HTTPS")}: ${
      config.httpsEnabled ? chalk.green(httpsModeLabel) : chalk.gray(httpsModeLabel)
    }`,
    `${chalk.bold("Dashboard")}: ${
      dashboard.dashboardDistDir
        ? chalk.cyan(dashboardUrl)
        : chalk.yellow("not found (run dashboard build)")
    }`,
    `${chalk.bold("Target")}: ${chalk.green(targetBaseUrl)}`,
    `${chalk.bold("History Limit")}: ${chalk.gray(String(historyLimit))}`,
    `${chalk.bold("Persist Recent")}: ${chalk.gray(
      String(effectiveHistoryPersistLimit),
    )}`,
    `${chalk.bold("Data Dir")}: ${chalk.gray(config.dataDir)}`,
  ].join("\n");

  console.log(
    boxen(summary, {
      title: ` ${chalk.bold(chalk.cyan("Proxira"))} `,
      titleAlignment: "center",
      borderColor: "cyan",
      borderStyle: "round",
      padding: { top: 0, right: 1, bottom: 0, left: 1 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }),
  );
  printStartupTips(config, proxyEntryUrl, dashboardUrl, targetBaseUrl);
};

const printStartupTips = (
  config: RuntimeConfig,
  proxyEntryUrl: string,
  dashboardUrl: string,
  targetBaseUrl: string,
): void => {
  const proxyEntryHint = config.proxyPrefixEnabled
    ? `（需带 ${config.proxyPrefix} 前缀）`
    : "（无需额外前缀）";
  const tips = [
    chalk.bold("使用说明"),
    `1) 将你要联调的 SDK/应用请求地址指向 ${chalk.cyan(proxyEntryUrl)}${proxyEntryHint}`,
    `2) 在浏览器打开 ${chalk.cyan(dashboardUrl)} 查看请求和响应详情`,
    `3) 通过面板可修改上游地址，当前生效值为 ${chalk.green(targetBaseUrl)}`,
    `4) 仅建议本地开发使用，请勿直接暴露到公网`,
  ];

  if (config.cliMode) {
    tips.push(
      "",
      chalk.gray(`运行 ${chalk.cyan("proxira --help")} 查看完整命令说明`),
    );
  }

  console.log(`\n${tips.join("\n")}`);
};
