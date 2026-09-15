import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "./helpers.js";

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

  it("forwards the full body downstream but only records up to maxBodyCaptureBytes", async () => {
    const fullPayload = JSON.stringify({
      ok: true,
      message: "this payload is larger than the capture limit",
    });
    const upstreamFetch = vi.fn(async () => {
      return new Response(fullPayload, {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }) as typeof fetch;
    const { app } = await createTestApp({
      configOverrides: { maxBodyCaptureBytes: 16 },
      fetchImpl: upstreamFetch,
    });

    const response = await app.request("/proxira/api/full");
    expect(response.status).toBe(200);
    // Downstream traffic is never clipped, only the recorded copy is.
    expect(await response.text()).toBe(fullPayload);

    const records = await app.request("/_proxira/api/records?limit=10");
    const payload = await records.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.responseBody).toMatchObject({
      text: fullPayload.slice(0, 16),
      size: fullPayload.length,
      truncated: true,
      isBinary: false,
      format: "json",
    });
  });

  it("records the full response body when it fits within maxBodyCaptureBytes", async () => {
    const fullPayload = JSON.stringify({ ok: true, message: "fits" });
    const upstreamFetch = vi.fn(async () => {
      return new Response(fullPayload, {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }) as typeof fetch;
    const { app } = await createTestApp({ fetchImpl: upstreamFetch });

    await app.request("/proxira/api/full");

    const records = await app.request("/_proxira/api/records?limit=10");
    const payload = await records.json();
    expect(payload.items[0]?.responseBody).toMatchObject({
      text: fullPayload,
      truncated: false,
      isBinary: false,
      format: "json",
    });
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

  it("never forwards reserved internal paths to the upstream, even with the prefix disabled", async () => {
    const upstreamFetch = vi.fn(async () => {
      return new Response("upstream", { status: 200 });
    }) as typeof fetch;
    const { app } = await createTestApp({
      configOverrides: { proxyPrefixEnabled: false, proxyPrefix: "" },
      fetchImpl: upstreamFetch,
    });

    const response = await app.request("/_proxira/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();

    // Ordinary traffic is still forwarded when the prefix is disabled.
    const forwarded = await app.request("/api/root");
    expect(forwarded.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("returns 504 when the upstream does not answer in time", async () => {
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("timed out");
            error.name = "TimeoutError";
            reject(error);
          });
        });
      },
    ) as typeof fetch;

    const { app } = await createTestApp({
      configOverrides: { upstreamTimeoutMs: 5 },
      fetchImpl: upstreamFetch,
    });

    const response = await app.request("/proxira/api/slow");
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      message: "Proxy upstream timed out.",
    });

    const records = await app.request("/_proxira/api/records?limit=10");
    const payload = await records.json();
    expect(payload.items[0]).toMatchObject({
      path: "/api/slow",
      responseStatus: null,
    });
  });

  it("passes streaming responses through instead of buffering them", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
        // Never closed on purpose: a real SSE response stays open.
      },
    });
    const upstreamFetch = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const { app } = await createTestApp({ fetchImpl: upstreamFetch });

    const response = await app.request("/proxira/api/events");
    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const chunk = await reader!.read();
    expect(new TextDecoder().decode(chunk.value)).toBe("data: hello\n\n");
    // A real SSE response never ends; reading the whole thing would hang, which
    // is exactly what the pass-through avoids. The cancel promise is not
    // awaited on purpose: a tee'd branch only resolves cancel once every
    // branch is cancelled, and the background sampler keeps its branch open.
    void reader!.cancel();

    const records = await app.request("/_proxira/api/records?limit=10");
    const payload = await records.json();
    expect(payload.items[0]).toMatchObject({
      responseStatus: 200,
      responseBody: null,
    });
  });

  it("samples a finished streaming response into the history record", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"n":1}\n\n'));
        controller.enqueue(encoder.encode('data: {"n":2}\n\n'));
        controller.close();
      },
    });
    const upstreamFetch = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const { app } = await createTestApp({ fetchImpl: upstreamFetch });
    const response = await app.request("/proxira/api/events");
    expect(await response.text()).toBe('data: {"n":1}\n\ndata: {"n":2}\n\n');

    // Sampling finishes in the background after the client stream ends.
    await vi.waitFor(
      async () => {
        const records = await app.request("/_proxira/api/records?limit=10");
        const payload = await records.json();
        expect(payload.items[0]?.responseBody?.text).toContain('data: {"n":2}');
      },
      { timeout: 3_000, interval: 50 },
    );

    const records = await app.request("/_proxira/api/records?limit=10");
    const payload = await records.json();
    expect(payload.items[0].responseBody).toMatchObject({
      truncated: false,
      isBinary: false,
    });
  });

  it("marks sampled streaming bodies as truncated past the capture limit", async () => {
    const encoder = new TextEncoder();
    const bigEvent = `data: ${"x".repeat(64)}\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 16; i += 1) {
          controller.enqueue(encoder.encode(bigEvent));
        }
        controller.close();
      },
    });
    const upstreamFetch = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const { app } = await createTestApp({
      fetchImpl: upstreamFetch,
      configOverrides: { maxBodyCaptureBytes: 100 },
    });
    const response = await app.request("/proxira/api/events");
    await response.text(); // drain the full client stream

    await vi.waitFor(
      async () => {
        const records = await app.request("/_proxira/api/records?limit=10");
        const payload = await records.json();
        expect(payload.items[0]?.responseBody?.truncated).toBe(true);
      },
      { timeout: 3_000, interval: 50 },
    );
  });

  it("exports a payload whose total matches the exported items", async () => {
    const upstreamFetch = vi.fn(async () => {
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const { app } = await createTestApp({ fetchImpl: upstreamFetch });

    await app.request("/proxira/api/a");
    await app.request("/proxira/api/b");

    const exported = await app.request("/_proxira/api/records/export?status=2xx");
    const payload = await exported.json();
    expect(payload.total).toBe(2);
    expect(payload.items).toHaveLength(payload.total);
  });

  it("collapses burst writes into a single persist and flushes on demand", async () => {
    const { app, runtime, fs } = await createTestApp({
      configOverrides: { persistDebounceMs: 5_000 },
    });

    await app.request("/proxira/api/a");
    await app.request("/proxira/api/b");
    await app.request("/proxira/api/c");

    // Debounce window is still open, so nothing should be on disk yet.
    expect(fs.existsSync("/tmp/proxira-test/history.json")).toBe(false);

    await runtime.flushPersist();

    const raw = await fs.readTextFile("/tmp/proxira-test/history.json");
    const persisted = JSON.parse(raw) as Record<string, unknown[]>;
    const total = Object.values(persisted).reduce(
      (sum, items) => sum + items.length,
      0,
    );
    expect(total).toBe(3);
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
