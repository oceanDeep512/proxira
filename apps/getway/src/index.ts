import { serve } from "@hono/node-server";
import { createApp } from "./app/create-app.js";
import { RuntimeStore } from "./app/runtime-store.js";
import { printStartupInfo } from "./app/startup-output.js";
import { loadRuntimeConfig } from "./config/env.js";
import { DashboardAssets } from "./dashboard/assets.js";
import { ProxyService } from "./proxy/service.js";
import { createNodeFileSystem } from "./shared/node-file-system.js";

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

  serve(
    {
      fetch: app.fetch,
      port: config.serverPort,
    },
    (info) => {
      printStartupInfo({
        config,
        dashboard,
        port: info.port,
        targetBaseUrl: runtime.getConfig().targetBaseUrl,
        historyLimit: config.historyLimit,
        effectiveHistoryPersistLimit: config.effectiveHistoryPersistLimit,
      });
    },
  );
};

void bootstrap();
