import { serve, getRequestListener } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer, type Server } from "node:net";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { createApp } from "./app/create-app.js";
import { RuntimeStore } from "./app/runtime-store.js";
import { printStartupInfo } from "./app/startup-output.js";
import { loadRuntimeConfig } from "./config/env.js";
import { DashboardAssets } from "./dashboard/assets.js";
import { ProxyService } from "./proxy/service.js";
import { createNodeFileSystem } from "./shared/node-file-system.js";

const getRandomPort = (): number => {
  // 使用 3000-50000 范围内的随机端口
  return 3000 + Math.floor(Math.random() * 47000);
};

const askForPort = async (defaultPort: number): Promise<number | null> => {
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
  config: ReturnType<typeof loadRuntimeConfig>,
  app: ReturnType<typeof createApp>,
  port: number,
  onListening: (port: number) => void,
): Promise<{ server: Server; port: number }> => {
  return new Promise((resolve, reject) => {
    let server: Server;

    const onError = (error: NodeJS.ErrnoException) => {
      if ("code" in error && error.code === "EADDRINUSE") {
        reject(error);
      } else {
        reject(error);
      }
    };

    if (config.httpsEnabled) {
      if (!config.httpsKeyPath || !config.httpsCertPath) {
        throw new Error(
          "HTTPS mode requires both PROXY_HTTPS_KEY_PATH and PROXY_HTTPS_CERT_PATH environment variables.",
        );
      }

      const listener = getRequestListener(app.fetch);
      server = createHttpsServer(
        {
          key: readFileSync(config.httpsKeyPath),
          cert: readFileSync(config.httpsCertPath),
        },
        listener,
      );

      server.once("error", onError);
      server.listen(port, "0.0.0.0", () => {
        server.removeListener("error", onError);
        const address = server.address();
        const actualPort =
          typeof address === "object" && address ? address.port : port;
        onListening(actualPort);
        resolve({ server, port: actualPort });
      });
    } else {
      // 对于 HTTP，先尝试用原生 net.Server 检查端口是否被占用
      const testServer = createNetServer();

      testServer.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          reject(error);
        } else {
          reject(error);
        }
      });

      testServer.listen(port, () => {
        testServer.close(() => {
          // 端口可用，现在用 @hono/node-server 启动
          server = serve(
            {
              fetch: app.fetch,
              port,
              hostname: "0.0.0.0",
            },
            (info) => {
              onListening(info.port);
              resolve({ server, port: info.port });
            },
          );
        });
      });
    }
  });
};

const bootstrap = async (): Promise<void> => {
  const fs = createNodeFileSystem();
  const config = loadRuntimeConfig(process.env, fs);
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
      await tryStartServer(config, app, currentPort, onListening);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if ("code" in err && err.code === "EADDRINUSE") {
        attempts++;

        const newPort = await askForPort(currentPort);
        if (newPort === null) {
          console.log(chalk.gray("已退出"));
          process.exit(0);
          return;
        }
        currentPort = newPort;
      } else {
        throw error;
      }
    }
  }

  console.error(chalk.red(`尝试了 ${maxAttempts} 次仍无法启动服务器，请手动指定端口`));
  process.exit(1);
};

void bootstrap();
