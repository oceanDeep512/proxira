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
      groups: [{ name: "默认转发地址" }],
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
    // The validation failure must name the reason, not just say "Invalid request.".
    expect(await invalid.json()).toEqual({
      message: expect.stringContaining("activeGroupId or targetBaseUrl is required."),
    });

    const initialConfig = await (
      await app.request("/_proxira/api/config")
    ).json();

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
    });
    // A new group must not hijack traffic: the active group stays untouched.
    expect(createdPayload.config.activeGroupId).toBe(
      initialConfig.activeGroupId,
    );

    // Switching is still possible explicitly.
    const switched = await app.request("/_proxira/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "switching",
        targetBaseUrl: "http://switching.test",
        switchToNew: true,
      }),
    });
    const switchedPayload = await switched.json();
    expect(switchedPayload.config.activeGroupId).toBe(switchedPayload.group.id);

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

  // Guards the wire contract of the endpoint the dashboard's target picker
  // calls. Renaming UI copy to "转发地址" must never touch these JSON keys —
  // a renamed key is invisible to the type checker, so it needs a test.
  it("switches the active target via PUT /config using the activeGroupId key", async () => {
    const { app } = await createTestApp();

    const initial = await (await app.request("/_proxira/api/config")).json();

    const created = await app.request("/_proxira/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "切换目标",
        targetBaseUrl: "http://switch.test",
        switchToNew: false,
      }),
    });
    expect(created.status).toBe(201);
    const spawned = await created.json();
    // Creating must not hijack live traffic.
    expect(spawned.config.activeGroupId).toBe(initial.activeGroupId);

    const switched = await app.request("/_proxira/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeGroupId: spawned.group.id }),
    });
    expect(switched.status).toBe(200);
    expect((await switched.json()).activeGroupId).toBe(spawned.group.id);

    // A renamed key must fail loudly rather than be silently ignored.
    const renamed = await app.request("/_proxira/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeTargetId: spawned.group.id }),
    });
    expect(renamed.status).toBe(400);
    expect((await renamed.json()).message).toContain(
      "activeGroupId or targetBaseUrl is required.",
    );
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

  it("re-clips bodies on disk but keeps the full capture in memory", async () => {
    const fullPayload = JSON.stringify({
      ok: true,
      message: "x".repeat(4_000),
    });
    const upstreamFetch = vi.fn(async () => {
      return new Response(fullPayload, {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }) as typeof fetch;

    const { app, runtime, fs, config } = await createTestApp({
      configOverrides: { historyPersistBodyLimitBytes: 128 },
      fetchImpl: upstreamFetch,
    });

    await app.request("/proxira/api/big");
    await runtime.flushPersist();

    // In-memory view keeps everything the capture limit allows.
    const records = await app.request("/_proxira/api/records?limit=10");
    const payload = await records.json();
    expect(payload.items[0]?.responseBody?.text).toBe(fullPayload);
    expect(payload.items[0]?.responseBody?.truncated).toBe(false);

    // history.json keeps only a bounded prefix per body.
    const persisted = JSON.parse(await fs.readTextFile(config.historyFile));
    const groupId = payload.groupId;
    const persistedRecord = persisted[groupId][0];
    expect(persistedRecord.responseBody.text.length).toBe(128);
    expect(persistedRecord.responseBody.truncated).toBe(true);
    // The true size is preserved so the UI can still say how big it was.
    expect(persistedRecord.responseBody.size).toBe(fullPayload.length);
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
    // The response is still streamed straight through: no buffering, and the
    // record already carries the sampled bytes instead of staying empty.
    void reader!.cancel();

    const records = await app.request("/_proxira/api/records?limit=10");
    const payload = await records.json();
    expect(payload.items[0]).toMatchObject({ responseStatus: 200 });
    await vi.waitFor(
      async () => {
        const refreshed = await (
          await app.request("/_proxira/api/records?limit=10")
        ).json();
        expect(refreshed.items[0]?.responseBody?.text).toContain("data: hello");
      },
      { timeout: 2_000, interval: 50 },
    );
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

  it("patches the record with partial bytes while the stream is still running", async () => {
    const encoder = new TextEncoder();
    let streamClosed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"n":1}\n\n'));
        // Second chunk lands while the stream is still open: the dashboard
        // must receive it as a partial body update before the stream ends.
        setTimeout(() => {
          controller.enqueue(encoder.encode('data: {"n":2}\n\n'));
        }, 1_200);
        setTimeout(() => {
          streamClosed = true;
          controller.close();
        }, 2_600);
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

    // Give the second chunk time to arrive and be emitted as a partial body.
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    await vi.waitFor(
      async () => {
        const records = await app.request("/_proxira/api/records?limit=10");
        const payload = await records.json();
        expect(payload.items[0]?.responseBody?.text).toContain('data: {"n":2}');
        // The update must land before the stream itself closes.
        expect(streamClosed).toBe(false);
      },
      { timeout: 1_000, interval: 100 },
    );

    // Drain the client branch so the test does not leave it dangling.
    void response.body?.cancel().catch(() => undefined);
  });

  it("marks sampled streaming bodies as truncated past the stream capture limit", async () => {
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
      configOverrides: { streamMaxCaptureBytes: 100 },
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

  it("captures streaming bodies in full by default, ignoring the non-stream body limit", async () => {
    const encoder = new TextEncoder();
    const bigEvent = `data: ${"x".repeat(64)}\n\n`;
    const total = bigEvent.length * 16;
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

    // 非流式上限故意设得比流内容小：流式响应不应继承它。
    const { app } = await createTestApp({
      fetchImpl: upstreamFetch,
      configOverrides: { maxBodyCaptureBytes: 100 },
    });
    const response = await app.request("/proxira/api/events");
    await response.text();

    await vi.waitFor(
      async () => {
        const records = await app.request("/_proxira/api/records?limit=10");
        const payload = await records.json();
        const body = payload.items[0]?.responseBody;
        expect(body?.truncated).toBe(false);
        expect(body?.text?.length).toBe(total);
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

// Never resolves on its own: it must be cut off by the abort signal, exactly
// like a real network fetch would be when the timeout fires.
const hangingUpstream = (): typeof fetch =>
  vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  ) as unknown as typeof fetch;




  it("pages records by offset so the dashboard can load more", async () => {
    const upstreamFetch = vi.fn(async () => {
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const { app } = await createTestApp({ fetchImpl: upstreamFetch });

    for (let i = 0; i < 5; i += 1) {
      await app.request(`/proxira/api/page-${i}`);
    }

    const firstPage = await (
      await app.request("/_proxira/api/records?limit=2&offset=0")
    ).json();
    const secondPage = await (
      await app.request("/_proxira/api/records?limit=2&offset=2")
    ).json();
    const lastPage = await (
      await app.request("/_proxira/api/records?limit=2&offset=4")
    ).json();

    expect(firstPage.total).toBe(5);
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(2);
    expect(lastPage.items).toHaveLength(1);

    const ids = [
      ...firstPage.items,
      ...secondPage.items,
      ...lastPage.items,
    ].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(5);
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

  describe("intervention rules", () => {
    const createRule = async (app: unknown, body: Record<string, unknown>) =>
      await (app as { request: (path: string, init?: RequestInit) => Promise<Response> }).request(
        "/_proxira/api/rules",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );

    it("stubs a response with a mock rule without touching the upstream", async () => {
      const upstreamFetch = vi.fn(async () => new Response("real", { status: 200 }));
      const { app } = await createTestApp({ fetchImpl: upstreamFetch as typeof fetch });

      const created = await createRule(app, {
        name: "stub users",
        matchPath: "/api/users",
        action: "mock",
        status: 201,
        headers: { "content-type": "application/json" },
        body: '{"stub":true}',
      });
      expect(created.status).toBe(201);

      const response = await app.request("/proxira/api/users");
      expect(response.status).toBe(201);
      expect(await response.text()).toBe('{"stub":true}');
      expect(upstreamFetch).not.toHaveBeenCalled();

      const records = await (await app.request("/_proxira/api/records?limit=1")).json();
      expect(records.items[0].appliedRuleId).toBe((await created.json()).rule.id);
    });

    it("streams a mock rule body as SSE", async () => {
      const { app } = await createTestApp();
      await createRule(app, {
        name: "stub stream",
        matchPath: "/api/stream",
        action: "mock",
        stream: true,
        chunkIntervalMs: 0,
        body: 'data: {"n":1}\n\ndata: {"n":2}\n\n',
      });

      const response = await app.request("/proxira/api/stream");
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const text = await response.text();
      expect(text).toContain('data: {"n":1}');
      expect(text).toContain('data: {"n":2}');
    });

    it("returns a simulated error for an error rule", async () => {
      const { app } = await createTestApp();
      await createRule(app, {
        name: "boom",
        matchPath: "/api/boom",
        action: "error",
        status: 503,
        message: "upstream exploded",
      });

      const response = await app.request("/proxira/api/boom");
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ message: "upstream exploded" });
    });

    it("delays the upstream call for a delay rule", async () => {
      const upstreamFetch = vi.fn(async () => new Response("ok", { status: 200 }));
      const { app } = await createTestApp({ fetchImpl: upstreamFetch as typeof fetch });
      await createRule(app, {
        name: "slow",
        matchPath: "/api/slow",
        action: "delay",
        delayMs: 250,
      });

      const startedAt = Date.now();
      const response = await app.request("/proxira/api/slow");
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
      expect(await response.text()).toBe("ok");
    });

    it("breaks a stream after N chunks and truncates bodies", async () => {
      const encoder = new TextEncoder();
      const makeStreamApp = async (action: string, extra: Record<string, unknown>) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 1; i <= 20; i += 1) {
              controller.enqueue(encoder.encode(`data: {"n":${i}}\n\n`));
            }
            controller.close();
          },
        });
        const upstreamFetch = vi.fn(
          async () =>
            new Response(stream, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            }),
        ) as typeof fetch;
        const { app } = await createTestApp({ fetchImpl: upstreamFetch });
        await createRule(app, {
          name: `${action} rule`,
          matchPath: "/api/shape",
          action,
          ...extra,
        });
        return app;
      };

      const breakApp = await makeStreamApp("break_stream", { afterChunks: 2 });
      const broken = await breakApp.request("/proxira/api/shape");
      const brokenText = await broken.text();
      expect((brokenText.match(/data:/g) ?? []).length).toBeLessThanOrEqual(3);

      const truncateApp = await makeStreamApp("truncate", { keepBytes: 20 });
      const truncated = await truncateApp.request("/proxira/api/shape");
      expect((await truncated.text()).length).toBeLessThanOrEqual(20);
    });

    it("supports rule CRUD and disables matching when disabled", async () => {
      const { app } = await createTestApp();
      const created = await createRule(app, {
        name: "toggle",
        matchPath: "/api/toggle",
        action: "mock",
        body: "stubbed",
      });
      const { rule } = await created.json();

      await app.request(`/_proxira/api/rules/${rule.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });

      // Disabled rules are skipped entirely: the request reaches the upstream.
      const passthrough = await app.request("/proxira/api/toggle");
      expect(await passthrough.text()).toContain("ok");

      const removed = await app.request(`/_proxira/api/rules/${rule.id}`, {
        method: "DELETE",
      });
      expect(await removed.json()).toMatchObject({ removed: true });
      const listed = await (await app.request("/_proxira/api/rules")).json();
      expect(listed.items).toHaveLength(0);
    });
  });

  describe("request replay", () => {
    it("re-issues a recorded request and records the new response", async () => {
      const upstreamFetch = vi.fn(async () => {
        return new Response(JSON.stringify({ ok: true, attempt: 2 }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }) as typeof fetch;
      const { app } = await createTestApp({ fetchImpl: upstreamFetch });

      await app.request("/proxira/api/first", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      const before = await (await app.request("/_proxira/api/records?limit=5")).json();
      const original = before.items[0];

      const replayed = await app.request("/_proxira/api/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordId: original.id }),
      });
      const payload = await replayed.json();
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe(200);
      expect(payload.body).toContain("attempt");
      expect(upstreamFetch).toHaveBeenCalledTimes(2);

      // The replay itself shows up in the history, flagged so the UI can tell
      // it apart from the original request.
      const after = await (await app.request("/_proxira/api/records?limit=5")).json();
      expect(after.items).toHaveLength(2);
      expect(after.items[0].id).toBe(payload.recordId);
      expect(after.items[0].source).toBe("replay");
      expect(after.items[1].source).toBe("proxy");
    });

    it("replays an edited request", async () => {
      const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        return new Response(
          JSON.stringify({ method: init?.method, url: String(input) }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;
      const { app } = await createTestApp({ fetchImpl: upstreamFetch });

      const replayed = await app.request("/_proxira/api/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "PUT",
          url: "http://upstream.test/api/edited",
          headers: { "content-type": "application/json" },
          body: '{"edited":true}',
        }),
      });
      const payload = await replayed.json();
      expect(payload.status).toBe(200);
      expect(payload.body).toContain("PUT");
      expect(payload.body).toContain("api/edited");
    });
  });

  describe("optional access token", () => {
    it("rejects internal requests without the token when one is configured", async () => {
      const { app } = await createTestApp({
        configOverrides: { accessToken: "secret-token" },
      });

      const unauthenticated = await app.request("/_proxira/api/config");
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toEqual({ message: "Unauthorized" });
    });

    it("accepts the token via header or query string", async () => {
      const { app } = await createTestApp({
        configOverrides: { accessToken: "secret-token" },
      });

      const viaHeader = await app.request("/_proxira/api/config", {
        headers: { authorization: "Bearer secret-token" },
      });
      expect(viaHeader.status).toBe(200);

      const viaQuery = await app.request("/_proxira/api/config?token=secret-token");
      expect(viaQuery.status).toBe(200);

      const wrongToken = await app.request("/_proxira/api/config?token=nope");
      expect(wrongToken.status).toBe(401);
    });

    it("leaves internal routes open when no token is configured", async () => {
      const { app } = await createTestApp();
      const response = await app.request("/_proxira/api/config");
      expect(response.status).toBe(200);
    });

    it("keeps the SSE stream protected", async () => {
      const { app } = await createTestApp({
        configOverrides: { accessToken: "secret-token" },
      });
      const response = await app.request("/_proxira/api/events");
      expect(response.status).toBe(401);
    });

    // The browser cannot attach a token to <script>/<link>/<img> requests, so the
    // dashboard shell would never boot if those were protected too.
    it("still serves the dashboard shell and its assets without a token", async () => {
      const { app } = await createTestApp({
        configOverrides: {
          accessToken: "secret-token",
          dashboardDistDir: "/dashboard-dist",
        },
        files: {
          "/dashboard-dist/index.html": "<html>dashboard</html>",
          "/dashboard-dist/assets/app.js": "console.log('ok')",
          "/dashboard-dist/favicon.svg": "<svg></svg>",
        },
      });

      const shell = await app.request("/_proxira/ui/");
      expect(shell.status).toBe(200);
      expect(await shell.text()).toContain("dashboard");

      const bundle = await app.request("/_proxira/ui/assets/app.js");
      expect(bundle.status).toBe(200);

      const favicon = await app.request("/_proxira/ui/favicon.svg");
      expect(favicon.status).toBe(200);
    });
  });

  describe("upstream timeout overrides", () => {
    it("times out with the global budget when the group has no override", async () => {
      const { app } = await createTestApp({
        fetchImpl: hangingUpstream(),
        configOverrides: { upstreamTimeoutMs: 80 },
      });

      const startedAt = Date.now();
      const response = await app.request("/proxira/api/slow");
      const elapsed = Date.now() - startedAt;
      expect(response.status).toBe(504);
      expect(elapsed).toBeGreaterThanOrEqual(60);
      expect(elapsed).toBeLessThan(600);
    });

    it("times out with the group override when one is configured", async () => {
      const { app } = await createTestApp({
        fetchImpl: hangingUpstream(),
        configOverrides: { upstreamTimeoutMs: 80 },
      });

      const config = await (await app.request("/_proxira/api/config")).json();
      const patched = await app.request(
        `/_proxira/api/groups/${config.activeGroupId}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ upstreamTimeoutMs: 400 }),
        },
      );
      expect(patched.status).toBe(200);
      expect((await patched.json()).group.upstreamTimeoutMs).toBe(400);

      const startedAt = Date.now();
      const response = await app.request("/proxira/api/slow");
      const elapsed = Date.now() - startedAt;
      expect(response.status).toBe(504);
      // The override must win: well above the 80ms global budget.
      expect(elapsed).toBeGreaterThanOrEqual(320);
      const payload = await response.json();
      expect(payload.error).toContain("400ms");

      // Clearing the override restores the global budget.
      await app.request(`/_proxira/api/groups/${config.activeGroupId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ upstreamTimeoutMs: null }),
      });
      const restartedAt = Date.now();
      const restored = await app.request("/proxira/api/slow");
      expect(restored.status).toBe(504);
      expect(Date.now() - restartedAt).toBeLessThan(320);
    });
  });

  describe("protocol upgrade (WebSocket) requests", () => {
    const handshakeHeaders = {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    };

    it("refuses a WebSocket handshake with 501 instead of downgrading it to a GET", async () => {
      const upstreamFetch = vi.fn(async () => new Response("plain body"));
      const { app } = await createTestApp({ fetchImpl: upstreamFetch });

      const response = await app.request("/proxira/socket", {
        headers: handshakeHeaders,
      });

      expect(response.status).toBe(501);
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining("not supported"),
        protocol: "websocket",
      });
      // The whole point: never pretend to forward it.
      expect(upstreamFetch).not.toHaveBeenCalled();
    });

    it("records the refusal so the dashboard does not show a healthy 200", async () => {
      const upstreamFetch = vi.fn(async () => new Response("plain body"));
      const { app } = await createTestApp({ fetchImpl: upstreamFetch });

      await app.request("/proxira/socket", { headers: handshakeHeaders });

      const payload = await (await app.request("/_proxira/api/records?limit=10")).json();
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toMatchObject({
        method: "GET",
        path: "/socket",
        responseStatus: 501,
        responseBody: null,
      });
      // The reason must be readable in the UI, not a generic forwarding error.
      expect(payload.items[0].error).toContain("WebSocket");
      expect(payload.items[0].error).toContain("never reached the upstream");
      // The handshake headers stay visible for diagnosis.
      expect(payload.items[0].requestHeaders).toMatchObject({
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      });
    });

    it("refuses any protocol upgrade, not just websocket", async () => {
      const upstreamFetch = vi.fn(async () => new Response("plain body"));
      const { app } = await createTestApp({ fetchImpl: upstreamFetch });

      const response = await app.request("/proxira/http2", {
        headers: { connection: "Upgrade, HTTP2-Settings", upgrade: "h2c" },
      });

      expect(response.status).toBe(501);
      expect(await response.json()).toMatchObject({ protocol: "h2c" });
      expect(upstreamFetch).not.toHaveBeenCalled();
    });

    it("still forwards an Upgrade header when Connection does not ask for it", async () => {
      const upstreamFetch = vi.fn(async () => new Response("ok", { status: 200 }));
      const { app } = await createTestApp({ fetchImpl: upstreamFetch });

      const response = await app.request("/proxira/api/plain", {
        headers: { upgrade: "websocket" },
      });

      expect(response.status).toBe(200);
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    });
  });
});