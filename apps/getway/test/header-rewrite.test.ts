import { describe, expect, it, vi } from "vitest";
import type { ProxyGroup } from "@proxira/core";
import { parseHeadersConfig } from "../src/headers/utils.js";
import { createTestApp } from "./helpers.js";

const jsonResponse = (): Response =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** Records every upstream call so the outbound headers can be asserted. */
const captureUpstream = () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return jsonResponse();
  });
  return { calls, impl: impl as unknown as typeof fetch };
};

const saveHeaderConfig = async (
  app: { request: (path: string, init?: RequestInit) => Promise<Response> },
  groupId: string,
  payload: Record<string, unknown>,
): Promise<Response> =>
  app.request(`/_proxira/api/groups/${encodeURIComponent(groupId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const activeGroupId = (group: ProxyGroup): string => group.id;

describe("outbound request headers", () => {
  it("appends every fixed header", async () => {
    const { calls, impl } = captureUpstream();
    const { app, runtime } = await createTestApp({ fetchImpl: impl });

    const saved = await saveHeaderConfig(app, activeGroupId(runtime.getProxyGroup()), {
      customHeaders: [
        { name: "x-tenant-id", value: "t-1" },
        { name: "x-trace-source", value: "proxira" },
      ],
    });
    expect(saved.status).toBe(200);

    await app.request("/proxira/api/orders");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get("x-tenant-id")).toBe("t-1");
    expect(calls[0]?.headers.get("x-trace-source")).toBe("proxira");
  });

  it("leaves the request untouched when nothing is configured", async () => {
    const { calls, impl } = captureUpstream();
    const { app } = await createTestApp({ fetchImpl: impl });

    await app.request("/proxira/api/orders", { headers: { "x-client": "yes" } });

    expect(calls[0]?.headers.get("x-client")).toBe("yes");
  });

  it("lets a rule rewrite a fixed header (rules run after the fixed list)", async () => {
    const { calls, impl } = captureUpstream();
    const { app, runtime } = await createTestApp({ fetchImpl: impl });

    await saveHeaderConfig(app, activeGroupId(runtime.getProxyGroup()), {
      customHeaders: [{ name: "authorization", value: "Bearer fixed" }],
      headerRules: [
        { namePrefix: "authorization", action: "set", value: "Bearer rotated" },
      ],
    });

    await app.request("/proxira/api/orders");

    expect(calls[0]?.headers.get("authorization")).toBe("Bearer rotated");
  });

  it("drops every header matched by an ignore prefix", async () => {
    const { calls, impl } = captureUpstream();
    const { app, runtime } = await createTestApp({ fetchImpl: impl });

    await saveHeaderConfig(app, activeGroupId(runtime.getProxyGroup()), {
      headerRules: [{ namePrefix: "x-debug-", action: "ignore" }],
    });

    await app.request("/proxira/api/orders", {
      headers: { "x-debug-trace": "1", "x-debug-flag": "2", "x-keep": "3" },
    });

    const outbound = calls[0]?.headers;
    expect(outbound?.get("x-debug-trace")).toBeNull();
    expect(outbound?.get("x-debug-flag")).toBeNull();
    expect(outbound?.get("x-keep")).toBe("3");
  });

  it("applies rules in order, so the last match wins", async () => {
    const { calls, impl } = captureUpstream();
    const { app, runtime } = await createTestApp({ fetchImpl: impl });

    await saveHeaderConfig(app, activeGroupId(runtime.getProxyGroup()), {
      headerRules: [
        { namePrefix: "x-env", action: "set", value: "first" },
        { namePrefix: "x-env", action: "set", value: "second" },
      ],
    });

    await app.request("/proxira/api/orders", { headers: { "x-env": "client" } });

    expect(calls[0]?.headers.get("x-env")).toBe("second");
  });

  it("skips disabled rules", async () => {
    const { calls, impl } = captureUpstream();
    const { app, runtime } = await createTestApp({ fetchImpl: impl });

    await saveHeaderConfig(app, activeGroupId(runtime.getProxyGroup()), {
      headerRules: [
        { namePrefix: "x-env", action: "set", value: "disabled", enabled: false },
      ],
    });

    await app.request("/proxira/api/orders", { headers: { "x-env": "client" } });

    expect(calls[0]?.headers.get("x-env")).toBe("client");
  });

  it("never lets a rule resurrect a proxy-owned header", async () => {
    const { calls, impl } = captureUpstream();
    const { app, runtime } = await createTestApp({ fetchImpl: impl });

    await saveHeaderConfig(app, activeGroupId(runtime.getProxyGroup()), {
      headerRules: [
        { namePrefix: "accept-encoding", action: "set", value: "gzip" },
        { namePrefix: "content-length", action: "set", value: "999" },
        { namePrefix: "host", action: "set", value: "evil.test" },
      ],
    });

    await app.request("/proxira/api/orders");

    const outbound = calls[0]?.headers;
    expect(outbound?.get("accept-encoding")).toBeNull();
    expect(outbound?.get("content-length")).toBeNull();
    expect(outbound?.get("host")).toBeNull();
  });

  it("rejects a protected or malformed fixed header instead of dropping it", async () => {
    const { app, runtime } = await createTestApp({ fetchImpl: captureUpstream().impl });
    const groupId = activeGroupId(runtime.getProxyGroup());

    const protectedName = await saveHeaderConfig(app, groupId, {
      customHeaders: [{ name: "Host", value: "evil.test" }],
    });
    expect(protectedName.status).toBe(400);

    const malformed = await saveHeaderConfig(app, groupId, {
      customHeaders: [{ name: "x-bad header", value: "1" }],
    });
    expect(malformed.status).toBe(400);

    const injected = await saveHeaderConfig(app, groupId, {
      headerRules: [{ namePrefix: "x-", action: "set", value: "a\r\nx-evil: 1" }],
    });
    expect(injected.status).toBe(400);
  });
});

describe("replay and custom headers", () => {
  it("keeps header config off unless the caller opts in", async () => {
    const { calls, impl } = captureUpstream();
    const { app, runtime } = await createTestApp({ fetchImpl: impl });

    await saveHeaderConfig(app, activeGroupId(runtime.getProxyGroup()), {
      customHeaders: [{ name: "x-tenant-id", value: "t-1" }],
    });

    await app.request("/_proxira/api/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://upstream.test/api/orders" }),
    });
    expect(calls[0]?.headers.get("x-tenant-id")).toBeNull();

    await app.request("/_proxira/api/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "http://upstream.test/api/orders",
        useCustomHeaders: true,
      }),
    });
    expect(calls[1]?.headers.get("x-tenant-id")).toBe("t-1");
  });
});

describe("persistence", () => {
  it("hydrates a config written before header support existed", async () => {
    const legacy = JSON.stringify({
      activeGroupId: "g-legacy",
      groups: [
        {
          id: "g-legacy",
          name: "旧配置",
          targetBaseUrl: "http://upstream.test",
          upstreamTimeoutMs: null,
        },
      ],
    });
    const { calls, impl } = captureUpstream();
    const { app, runtime } = await createTestApp({
      files: { "/tmp/proxira-test/config.json": legacy },
      fetchImpl: impl,
    });

    const group = runtime.getProxyGroup();
    expect(group.customHeaders).toEqual([]);
    expect(group.headerRules).toEqual([]);

    await app.request("/proxira/api/orders");
    expect(calls).toHaveLength(1);
  });

  it("round-trips the header config through the API", async () => {
    const { app, runtime } = await createTestApp({ fetchImpl: captureUpstream().impl });
    const groupId = activeGroupId(runtime.getProxyGroup());

    await saveHeaderConfig(app, groupId, {
      customHeaders: [{ name: "x-tenant-id", value: "t-1" }],
      headerRules: [{ namePrefix: "x-internal-", action: "ignore" }],
    });

    const response = await app.request("/_proxira/api/config");
    const config = (await response.json()) as { groups: ProxyGroup[] };
    const group = config.groups[0];

    expect(group?.customHeaders).toEqual([
      { id: expect.any(String), name: "x-tenant-id", value: "t-1" },
    ]);
    expect(group?.headerRules).toEqual([
      {
        id: expect.any(String),
        enabled: true,
        namePrefix: "x-internal-",
        action: "ignore",
        value: "",
      },
    ]);
  });
});

describe("parseHeadersConfig", () => {
  const uuid = () => "generated";

  it("keeps the last entry for a duplicated name without reordering", () => {
    const { customHeaders, problems } = parseHeadersConfig(
      {
        customHeaders: [
          { name: "x-a", value: "1" },
          { name: "x-b", value: "2" },
          { name: "X-A", value: "3" },
        ],
      },
      uuid,
    );

    expect(problems).toEqual([]);
    // The later entry wins outright (value and spelling), but keeps the first
    // position so the dashboard list does not reshuffle while typing.
    expect(customHeaders.map((entry) => [entry.name, entry.value])).toEqual([
      ["X-A", "3"],
      ["x-b", "2"],
    ]);
  });

  it("reports skipped entries instead of throwing", () => {
    const { customHeaders, problems } = parseHeadersConfig(
      {
        customHeaders: [{ name: "host", value: "x" }, { name: "", value: "y" }],
        headerRules: [{ namePrefix: "", action: "set", value: "z" }],
      },
      uuid,
    );

    expect(customHeaders).toEqual([]);
    expect(problems).toHaveLength(3);
  });

  it("treats a malformed action as set and clears the value on ignore", () => {
    const { headerRules } = parseHeadersConfig(
      {
        headerRules: [
          { namePrefix: "x-a", action: "nonsense", value: "v" },
          { namePrefix: "x-b", action: "ignore", value: "leftover" },
        ],
      },
      uuid,
    );

    expect(headerRules[0]?.action).toBe("set");
    expect(headerRules[1]?.value).toBe("");
  });
});
