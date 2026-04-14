import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/create-app.js";
import { RuntimeStore } from "../src/app/runtime-store.js";
import type { FileSystemAdapter, RuntimeConfig, RuntimeDeps } from "../src/app/types.js";
import { DashboardAssets } from "../src/dashboard/assets.js";
import { ProxyService } from "../src/proxy/service.js";

class MemoryFileSystem implements FileSystemAdapter {
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

const createTestConfig = (overrides: Partial<RuntimeConfig> = {}): RuntimeConfig => {
  return {
    internalRoutePrefix: "/_proxira",
    defaultProxyPrefix: "/proxira",
    serverPort: 3000,
    bodyLimit: 32_768,
    maxQueryLimit: 500,
    sseHeartbeatMs: 15_000,
    requestContentLengthLimit: 10 * 1024 * 1024,
    responseBufferLimit: 10 * 1024 * 1024,
    historyLimit: 1_000,
    historyPersistLimit: 200,
    effectiveHistoryPersistLimit: 200,
    disableStartupBanner: true,
    dataDir: "/tmp/proxira-test",
    configFile: "/tmp/proxira-test/config.json",
    historyFile: "/tmp/proxira-test/history.json",
    defaultTargetBaseUrl: "http://upstream.test",
    proxyPrefixEnabled: true,
    proxyPrefix: "/proxira",
    dashboardDistDir: null,
    cliMode: false,
    ...overrides,
  };
};

const createTestApp = async (options: {
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

  return { app, config, runtime };
};

describe("createApp", () => {
  it("serves health, status, and default config without starting a server", async () => {
    const { app } = await createTestApp();

    const health = await app.request("/_proxira/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });

    const config = await app.request("/_proxira/api/config");
    expect(config.status).toBe(200);
    expect(await config.json()).toMatchObject({
      targetBaseUrl: "http://upstream.test",
      groups: [{ name: "默认分组" }],
    });

    const status = await app.request("/_proxira/api/status");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      historySize: 0,
      sseClients: 0,
    });
  });

  it("validates JSON payloads and supports group lifecycle APIs", async () => {
    const { app } = await createTestApp();

    const invalid = await app.request("/_proxira/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ message: "Invalid request." });

    const created = await app.request("/_proxira/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "staging",
        targetBaseUrl: "http://staging.test",
      }),
    });
    expect(created.status).toBe(201);
    const createdPayload = await created.json();
    expect(createdPayload).toMatchObject({
      group: { name: "staging", targetBaseUrl: "http://staging.test" },
      config: { activeGroupId: createdPayload.group.id },
    });

    const updated = await app.request(
      `/_proxira/api/groups/${createdPayload.group.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "staging-2",
          targetBaseUrl: "http://staging-2.test",
          makeActive: true,
        }),
      },
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      group: { name: "staging-2", targetBaseUrl: "http://staging-2.test" },
    });

    const removed = await app.request(
      `/_proxira/api/groups/${createdPayload.group.id}`,
      { method: "DELETE" },
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      removed: true,
      id: createdPayload.group.id,
    });
  });

  it("forwards prefixed proxy requests, records history, and exports records", async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      return new Response(JSON.stringify({ upstream: String(input) }), {
        status: 201,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-upstream": "ok",
        },
      });
    }) as typeof fetch;
    const { app } = await createTestApp({ fetchImpl: upstreamFetch });

    const response = await app.request("/proxira/api/users?foo=bar", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client": "test",
      },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(response.status).toBe(201);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(String(upstreamFetch.mock.calls[0]?.[0])).toBe(
      "http://upstream.test/api/users?foo=bar",
    );

    const records = await app.request("/_proxira/api/records?limit=10");
    const recordsPayload = await records.json();
    expect(recordsPayload.items).toHaveLength(1);
    expect(recordsPayload.items[0]).toMatchObject({
      method: "POST",
      path: "/api/users",
      upstreamUrl: "http://upstream.test/api/users?foo=bar",
      responseStatus: 201,
    });

    const exported = await app.request("/_proxira/api/records/export");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain(
      "proxira-",
    );
  });

  it("supports proxying without a business prefix", async () => {
    const upstreamFetch = vi.fn(async () => {
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const { app } = await createTestApp({
      configOverrides: { proxyPrefixEnabled: false, proxyPrefix: "" },
      fetchImpl: upstreamFetch,
    });

    const response = await app.request("/api/root");
    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(String(upstreamFetch.mock.calls[0]?.[0])).toBe(
      "http://upstream.test/api/root",
    );
  });

  it("returns 502 and records proxy errors when upstream fetch fails", async () => {
    const upstreamFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const { app } = await createTestApp({ fetchImpl: upstreamFetch });

    const response = await app.request("/proxira/api/fail");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      message: "Proxy forwarding failed.",
      error: "network down",
    });

    const records = await app.request("/_proxira/api/records?limit=10");
    const payload = await records.json();
    expect(payload.items[0]).toMatchObject({
      path: "/api/fail",
      responseStatus: null,
      error: "network down",
    });
  });

  it("serves dashboard assets, falls back to index.html, and keeps unmatched paths on 404", async () => {
    const { app } = await createTestApp({
      configOverrides: { dashboardDistDir: "/dashboard-dist" },
      files: {
        "/dashboard-dist/index.html": "<html>dashboard</html>",
        "/dashboard-dist/assets/app.js": "console.log('ok')",
      },
    });

    const dashboardRoute = await app.request("/_proxira/ui/route/test");
    expect(dashboardRoute.status).toBe(200);
    expect(await dashboardRoute.text()).toContain("dashboard");

    const dashboardAsset = await app.request("/_proxira/ui/assets/app.js");
    expect(dashboardAsset.status).toBe(200);
    expect(await dashboardAsset.text()).toContain("console.log");

    const notFound = await app.request("/outside");
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ message: "Not Found" });
  });
});
