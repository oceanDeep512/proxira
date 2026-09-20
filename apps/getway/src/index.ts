import { serve, getRequestListener } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import type { Server } from "node:net";
import { createInterface } from "node:readline";
import { rm } from "node:fs/promises";
import chalk from "chalk";
import { createApp } from "./app/create-app.js";
import { RuntimeStore } from "./app/runtime-store.js";
import { printStartupInfo } from "./app/startup-output.js";
import {
  instanceFilePath,
  readActiveInstance,
} from "./config/data-dir.js";
import { loadRuntimeConfig } from "./config/env.js";
import { DashboardAssets } from "./dashboard/assets.js";
import { ProxyService } from "./proxy/service.js";
import { createNodeFileSystem } from "./shared/node-file-system.js";
import { validateHost } from "./shared/network.js";

type RuntimeConfig = ReturnType<typeof loadRuntimeConfig>;
type App = ReturnType<typeof createApp>;

const getRandomPort = (): number => {
  // 使用 3000-50000 范围内的随机端口
  return 3000 + Math.floor(Math.random() * 47000);
};

const askForPort = async (defaultPort: number): Promise<number | null> => {
  // No stdin to read from (Docker, CI, background job): asking would hang the
  // process forever, so fall back to an OS assigned port instead.
  if (!process.stdin.isTTY) {
    console.log("");
    console.log(
      chalk.yellow(`端口 ${chalk.bold(defaultPort)} 已被占用，且当前环境不支持交互输入`),
    );
    console.log(chalk.gray("已自动改用系统分配端口，启动后会打印实际端口。"));
    console.log("");
    return 0;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log("");
    console.log(
      chalk.yellow(`端口 ${chalk.bold(defaultPort)} 已被占用`),
    );
    console.log("");
    console.log(chalk.gray("请选择："));
    console.log(
      `  ${chalk.cyan("1")} - 输入新端口号`,
    );
    console.log(
      `  ${chalk.cyan("2")} - 随机分配端口`,
    );
    console.log(
      `  ${chalk.cyan("Q")} - 退出`,
    );
    console.log("");

    let resolved = false;

    const cleanup = () => {
      rl.close();
      process.stdin.removeListener("data", onData);
    };

    const onData = (data: Buffer) => {
      if (data.toString().includes("\u0003")) {
        // Ctrl+C
        cleanup();
        resolve(null);
      }
    };

    process.stdin.on("data", onData);

    rl.question(chalk.cyan("请选择 [1/2/Q] "), (answer) => {
      if (resolved) return;
      resolved = true;
      cleanup();

      const trimmed = answer.trim().toLowerCase();

      if (trimmed === "q" || trimmed === "quit" || trimmed === "exit") {
        resolve(null);
        return;
      }

      if (trimmed === "2") {
        resolve(getRandomPort());
        return;
      }

      if (trimmed === "1" || trimmed === "") {
        rl.question(chalk.cyan("请输入端口号: "), (portAnswer) => {
          const port = Number(portAnswer.trim());
          if (Number.isFinite(port) && port > 0 && port <= 65535) {
            resolve(port);
          } else {
            console.log(chalk.red("无效的端口号，使用随机端口"));
            resolve(getRandomPort());
          }
        });
        return;
      }

      // 默认随机端口
      console.log(chalk.gray("使用随机端口"));
      resolve(getRandomPort());
    });
  });
};

const tryStartServer = (
  config: RuntimeConfig,
  app: App,
  port: number,
  onListening: (port: number) => void,
): Promise<{ server: Server; port: number }> => {
  return new Promise((resolve, reject) => {
    let settled = false;

    // Before the first successful listen an error means "could not bind";
    // afterwards it is a runtime error that should be reported, not swallowed.
    const handleError = (error: NodeJS.ErrnoException): void => {
      if (settled) {
        console.error(chalk.red(`[proxira] 服务运行出错：${error.message}`));
        return;
      }
      settled = true;
      reject(error);
    };

    const settle = (server: Server, actualPort: number): void => {
      if (settled) return;
      settled = true;
      onListening(actualPort);
      resolve({ server, port: actualPort });
    };

    if (config.httpsEnabled) {
      if (!config.httpsKeyPath || !config.httpsCertPath) {
        reject(
          new Error(
            "HTTPS 模式需要同时提供证书与私钥，请检查 --https-key / --https-cert。",
          ),
        );
        return;
      }

      let key: Buffer;
      let cert: Buffer;
      try {
        key = readFileSync(config.httpsKeyPath);
        cert = readFileSync(config.httpsCertPath);
      } catch (error) {
        reject(
          new Error(
            `读取 HTTPS 证书失败：${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        return;
      }

      const server = createHttpsServer(
        { key, cert },
        getRequestListener(app.fetch),
      );
      // Attach before listen so EADDRINUSE rejects instead of crashing as an
      // unhandled 'error' event.
      server.on("error", handleError);
      server.listen(port, config.host, () => {
        const address = server.address();
        settle(
          server,
          typeof address === "object" && address ? address.port : port,
        );
      });
      return;
    }

    let server: Server;
    server = serve(
      {
        fetch: app.fetch,
        port,
        hostname: config.host,
      },
      (info) => {
        settle(server, info.port);
      },
    );
    server.on("error", handleError);
  });
};

const registerShutdownHooks = (
  runtime: RuntimeStore,
  server: Server,
  dataDir: string,
): void => {
  let shuttingDown = false;

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    // Debounced writes must land before the process goes away.
    void runtime
      .flushPersist()
      .catch(() => undefined)
      .finally(() => {
        // A stale instance.json would make the next launch warn about a
        // concurrent instance that no longer exists.
        rm(instanceFilePath(dataDir), { force: true })
          .catch(() => undefined)
          .finally(() => {
            server.close(() => {
              process.exit(0);
            });
            // Do not hang forever if a keep-alive connection refuses to close.
            setTimeout(() => process.exit(0), 1_000).unref();
          });
      });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

const bootstrap = async (): Promise<void> => {
  const fs = createNodeFileSystem();
  const config = loadRuntimeConfig(process.env, fs);

  // 监听地址填错时 node 只报 getaddrinfo ENOTFOUND，看不出该怎么改。
  const hostCheck = validateHost(config.host);
  if (!hostCheck.ok) {
    console.error(chalk.red(`[proxira] ${hostCheck.message}`));
    process.exit(1);
  }

  const startedAt = Date.now();
  const runtime = new RuntimeStore({
    config,
    fs,
    fetch,
    now: () => Date.now(),
    randomUUID: () => crypto.randomUUID(),
    logger: console,
  });
  const dashboard = new DashboardAssets(config, fs);
  const proxyService = new ProxyService(
    {
      config,
      fs,
      fetch,
      now: () => Date.now(),
      randomUUID: () => crypto.randomUUID(),
      logger: console,
    },
    runtime,
  );

  await runtime.hydrate();

  // Shared data directory: warn when another live instance is writing to the
  // same config/history files instead of silently interleaving writes.
  const activeInstance = await readActiveInstance(config.dataDir, fs);
  if (activeInstance) {
    console.log("");
    console.log(
      chalk.yellow(
        `[proxira] 警告：检测到另一个实例正在运行（PID ${activeInstance.pid}，端口 ${activeInstance.port}），且共用同一数据目录。`,
      ),
    );
    console.log(
      chalk.gray("  两个实例会互相覆盖配置与历史；如需并行调试，请用 --data-dir 隔离数据目录。"),
    );
    console.log("");
  }

  const app = createApp({
    config,
    runtime,
    dashboard,
    proxyService,
    getStatus: () => {
      const snapshot = runtime.getSnapshot();
      return {
        startedAt: new Date(startedAt).toISOString(),
        uptimeMs: Date.now() - startedAt,
        config: snapshot.config,
        historySize: snapshot.historySize,
        sseClients: snapshot.sseClients,
        dataDir: config.dataDir,
      };
    },
    logger: console,
  });

  const onListening = (port: number): void => {
    printStartupInfo({
      config,
      dashboard,
      port,
      targetBaseUrl: runtime.getConfig().targetBaseUrl,
      historyLimit: config.historyLimit,
      effectiveHistoryPersistLimit: config.effectiveHistoryPersistLimit,
    });
  };

  let currentPort = config.serverPort;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    try {
      const started = await tryStartServer(config, app, currentPort, onListening);
      // Mark this instance as the live owner of the data directory. Written
      // after a successful listen so the recorded port is the real one.
      await fs
        .mkdir(config.dataDir, { recursive: true })
        .then(() =>
          fs.writeTextFile(
            instanceFilePath(config.dataDir),
            JSON.stringify(
              {
                pid: process.pid,
                port: started.port,
                startedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          ),
        );
      registerShutdownHooks(runtime, started.server, config.dataDir);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if ("code" in err && err.code === "EADDRINUSE") {
        attempts++;

        const newPort = await askForPort(currentPort);
        if (newPort === null) {
          console.log(chalk.gray("已退出"));
          return;
        }
        currentPort = newPort;
      } else {
        throw error;
      }
    }
  }

  throw new Error(
    `尝试了 ${maxAttempts} 次仍无法启动服务器，请使用 -p/--port 手动指定端口。`,
  );
};

bootstrap().catch((error: unknown) => {
  console.error(
    chalk.red(`[proxira] ${error instanceof Error ? error.message : String(error)}`),
  );
  process.exit(1);
});
