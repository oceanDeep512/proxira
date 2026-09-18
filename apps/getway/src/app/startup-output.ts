import boxen from "boxen";
import chalk from "chalk";
import type { RuntimeConfig } from "./types.js";
import { DashboardAssets } from "../dashboard/assets.js";
import { PROXIRA_LOGO_LINES } from "../logo.js";
import { describeDataDirSource } from "../config/data-dir.js";
import { listLanAddresses, resolveReachableAddresses } from "../shared/network.js";

type NetworkInfo = { addresses: string[]; hint: string | null };

const resolveNetworkInfo = (options: {
  protocol: string;
  port: number;
  host: string;
}): NetworkInfo => {
  const { protocol, port, host } = options;
  const addresses = resolveReachableAddresses(host, listLanAddresses());
  if (addresses.length > 0) {
    return {
      addresses: addresses.map((address) => `${protocol}://${address}:${port}`),
      hint: null,
    };
  }
  // 监听回环地址时局域网地址根本连不上，展示一个打不开的 URL 只会误导人。
  const isWildcard = host.trim() === "0.0.0.0" || host.trim() === "::";
  return {
    addresses: [],
    hint: isWildcard
      ? "未检测到局域网地址"
      : `未暴露（当前仅监听 ${host}，加 --host lan 可暴露到局域网）`,
  };
};

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
  const localBase = `${protocol}://localhost:${port}`;
  const withPrefix = (base: string): string =>
    config.proxyPrefixEnabled ? `${base}${config.proxyPrefix}` : base;
  const localEntryUrl = withPrefix(localBase);
  const localDashboardUrl = `${localBase}${config.internalRoutePrefix}/ui`;
  const proxyModeLabel = config.proxyPrefixEnabled
    ? config.proxyPrefix
    : "disabled";
  const httpsModeLabel = config.httpsEnabled ? "enabled" : "disabled";
  const network = resolveNetworkInfo({ protocol, port, host: config.host });

  // 局域网可达时，把局域网地址当作「这台机器对外的地址」放在最显眼的位置：
  // 这才是别的机器要填的地址。localhost 退到第二行给本机自己用。
  const lanBase = network.addresses[0] ?? null;
  const primaryBase = lanBase ?? localBase;
  const primaryEntryUrl = withPrefix(primaryBase);
  const primaryDashboardUrl = `${primaryBase}${config.internalRoutePrefix}/ui`;

  if (config.disableStartupBanner) {
    console.log(`代理服务已启动：${primaryBase}`);
    console.log(`监听地址：${config.host}`);
    console.log(`代理入口：${primaryEntryUrl}`);
    if (lanBase) {
      console.log(`本机入口：${localEntryUrl}`);
    }
    if (network.addresses.length > 0) {
      for (const url of network.addresses) {
        console.log(`局域网：${url}`);
      }
    } else if (network.hint) {
      console.log(`局域网：${network.hint}`);
    }
    console.log(`代理前缀：${proxyModeLabel}`);
    console.log(`HTTPS 模式：${httpsModeLabel}`);
    console.log(`当前上游地址：${targetBaseUrl}`);
    console.log(`数据目录：${config.dataDir}（${describeDataDirSource(config.dataDirSource)}）`);
    console.log(`历史记录上限：${historyLimit}`);
    console.log(`本地持久化最近条数：${effectiveHistoryPersistLimit}`);
    console.log(`访问令牌：${config.accessToken ? "已启用" : "未启用"}`);
    if (dashboard.dashboardDistDir) {
      console.log(`管理面板：${primaryDashboardUrl}`);
    } else {
      console.log(
        "未检测到管理面板构建产物，请先执行 `pnpm --filter @proxira/dashboard build`。",
      );
    }
    printStartupTips(
      config,
      primaryEntryUrl,
      primaryDashboardUrl,
      targetBaseUrl,
      lanBase,
    );
    return;
  }

  const logo = PROXIRA_LOGO_LINES.map((line, index) =>
    [chalk.cyanBright, chalk.blueBright, chalk.magentaBright][index % 3]!(line),
  ).join("\n");

  const lanExtra = network.addresses.slice(1);
  const summary = [
    logo,
    "",
    `${chalk.bold("Proxy")}: ${chalk.cyan(primaryEntryUrl)}`,
    // 有局域网地址时 localhost 只是本机入口；没有时 Proxy 已经是 localhost，不重复。
    ...(lanBase
      ? [`${chalk.bold("Local")}: ${chalk.gray(localEntryUrl)}`]
      : []),
    `${chalk.bold("Host")}: ${chalk.gray(config.host)}`,
    `${chalk.bold("Prefix")}: ${chalk.gray(proxyModeLabel)}`,
    `${chalk.bold("HTTPS")}: ${
      config.httpsEnabled ? chalk.green(httpsModeLabel) : chalk.gray(httpsModeLabel)
    }`,
    `${chalk.bold("Dashboard")}: ${
      dashboard.dashboardDistDir
        ? chalk.cyan(primaryDashboardUrl)
        : chalk.yellow("not found (run dashboard build)")
    }`,
    ...(network.addresses.length > 0
      ? lanExtra.map((url) => `${chalk.bold("Network")}: ${chalk.cyan(url)}`)
      : [`${chalk.bold("Network")}: ${chalk.gray(network.hint)}`]),
    `${chalk.bold("Target")}: ${chalk.green(targetBaseUrl)}`,
    `${chalk.bold("History Limit")}: ${chalk.gray(String(historyLimit))}`,
    `${chalk.bold("Persist Recent")}: ${chalk.gray(
      String(effectiveHistoryPersistLimit),
    )}`,
    `${chalk.bold("Access Token")}: ${
      config.accessToken ? chalk.green("enabled") : chalk.gray("disabled")
    }`,
    `${chalk.bold("Data Dir")}: ${chalk.gray(config.dataDir)}`,
    `${chalk.bold("Data Dir Source")}: ${chalk.gray(
      describeDataDirSource(config.dataDirSource),
    )}`,
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
  printStartupTips(
    config,
    primaryEntryUrl,
    primaryDashboardUrl,
    targetBaseUrl,
    lanBase,
  );
};

const printStartupTips = (
  config: RuntimeConfig,
  proxyEntryUrl: string,
  dashboardUrl: string,
  targetBaseUrl: string,
  networkBaseUrl: string | null,
): void => {
  const proxyEntryHint = config.proxyPrefixEnabled
    ? `（需带 ${config.proxyPrefix} 前缀）`
    : "（无需额外前缀）";
  const tips = [
    chalk.bold("使用说明"),
    `1) 将你要联调的 SDK/应用请求地址指向 ${chalk.cyan(proxyEntryUrl)}${proxyEntryHint}`,
    `2) 在浏览器打开 ${chalk.cyan(dashboardUrl)} 查看请求和响应详情`,
    `3) 通过面板可修改上游地址，当前生效值为 ${chalk.green(targetBaseUrl)}`,
  ];

  if (networkBaseUrl) {
    // 已经对局域网开放：把「别的机器怎么连」讲成可直接照抄的一句话。
    const lanEntry = config.proxyPrefixEnabled
      ? `${networkBaseUrl}${config.proxyPrefix}`
      : networkBaseUrl;
    tips.push(
      `4) 同一网络下的其他电脑把请求地址填成 ${chalk.cyan(
        lanEntry,
      )}，面板填 ${chalk.cyan(`${networkBaseUrl}${config.internalRoutePrefix}/ui`)}`,
      chalk.yellow(`   注意：已对局域网开放，请确认当前网络可信`),
    );
  } else {
    tips.push(
      `4) 当前只监听 ${chalk.gray(config.host)}，${chalk.yellow(
        "其他电脑连不上这台机器",
      )}；要让局域网内其他设备访问，用 ${chalk.cyan("proxira --host lan")} 重启`,
    );
  }
  tips.push(`5) 仅建议本地开发使用，请勿直接暴露到公网`);

  if (config.cliMode) {
    tips.push(
      "",
      chalk.gray(`运行 ${chalk.cyan("proxira --help")} 查看完整命令说明`),
    );
  }

  console.log(`\n${tips.join("\n")}`);
};
