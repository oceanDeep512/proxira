import { vi } from "vitest";
import { createApp } from "../src/app/create-app.js";
import { RuntimeStore } from "../src/app/runtime-store.js";
import type { FileSystemAdapter, RuntimeConfig, RuntimeDeps } from "../src/app/types.js";
import { DashboardAssets } from "../src/dashboard/assets.js";
import { ProxyService } from "../src/proxy/service.js";

export class MemoryFileSystem implements FileSystemAdapter {
  private readonly files = new Map<string, string | Uint8Array>();

  constructor(initialFiles: Record<string, string | Uint8Array> = {}) {
    for (const [path, value] of Object.entries(initialFiles)) {
      this.files.set(path, value);
    }
  }

  existsSync(path: string): boolean {
    return this.files.has(path);
  }

  async mkdir(): Promise<void> {}

  async readTextFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return typeof value === "string" ? value : new TextDecoder().decode(value);
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    if (typeof value === "string") {
      return new TextEncoder().encode(value);
    }
    return value;
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
}

export const createTestConfig = (
  overrides: Partial<RuntimeConfig> = {},
): RuntimeConfig => {
  return {
    internalRoutePrefix: "/_proxira",
    defaultProxyPrefix: "/proxira",
    host: "127.0.0.1",
    serverPort: 3000,
    maxBodyCaptureBytes: 2 * 1024 * 1024,
    upstreamTimeoutMs: 30_000,
    persistDebounceMs: 0,
    maxQueryLimit: 500,
    sseHeartbeatMs: 15_000,
    requestContentLengthLimit: 10 * 1024 * 1024,
    historyLimit: 1_000,
    historyPersistLimit: 200,
    effectiveHistoryPersistLimit: 200,
    historyPersistBodyLimitBytes: 64 * 1024,
    disableStartupBanner: true,
    dataDir: "/tmp/proxira-test",
    configFile: "/tmp/proxira-test/config.json",
    historyFile: "/tmp/proxira-test/history.json",
    rulesFile: "/tmp/proxira-test/rules.json",
    defaultTargetBaseUrl: "http://upstream.test",
    proxyPrefixEnabled: true,
    proxyPrefix: "/proxira",
    dashboardDistDir: null,
    cliMode: false,
    httpsEnabled: false,
    httpsKeyPath: null,
    httpsCertPath: null,
    accessToken: null,
    ...overrides,
  };
};

export const createTestApp = async (options: {
  configOverrides?: Partial<RuntimeConfig>;
  files?: Record<string, string | Uint8Array>;
  fetchImpl?: typeof fetch;
} = {}) => {
  const fs = new MemoryFileSystem(options.files);
  const config = createTestConfig(options.configOverrides);
  let id = 0;
  let now = 1_700_000_000_000;

  const deps: RuntimeDeps = {
    config,
    fs,
    fetch:
      options.fetchImpl ??
      (vi.fn(async () => {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }) as typeof fetch),
    now: () => {
      now += 10;
      return now;
    },
    randomUUID: () => `uuid-${++id}`,
    logger: { log: vi.fn(), error: vi.fn() },
  };

  const runtime = new RuntimeStore(deps);
  await runtime.hydrate();
  const dashboard = new DashboardAssets(config, fs);
  const proxyService = new ProxyService(deps, runtime);
  const startedAt = 1_699_999_999_000;
  const app = createApp({
    config,
    runtime,
    dashboard,
    proxyService,
    getStatus: () => {
      const snapshot = runtime.getSnapshot();
      return {
        startedAt: new Date(startedAt).toISOString(),
        uptimeMs: deps.now() - startedAt,
        config: snapshot.config,
        historySize: snapshot.historySize,
        sseClients: snapshot.sseClients,
      };
    },
    logger: deps.logger,
  });

  return { app, config, runtime, fs, deps };
};
