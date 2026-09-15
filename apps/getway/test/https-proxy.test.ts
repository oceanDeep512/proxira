import { describe, expect, it, vi } from "vitest";
import { createTestConfig, createTestApp } from "./helpers.js";

describe("HTTPS Proxy Functionality", () => {
  it("proxy recording logic is protocol-agnostic - application layer works regardless of transport", async () => {
    // The proxy service doesn't care about transport layer (HTTP vs HTTPS)
    // It only processes Request/Response objects
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      return new Response(JSON.stringify({ https: "works" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }) as typeof fetch;

    const { app, runtime } = await createTestApp({ fetchImpl: upstreamFetch });

    // Make a request through the proxy (this simulates what would happen over HTTPS)
    const response = await app.request("/proxira/api/secure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: "data" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ https: "works" });

    // Verify the request was recorded
    const snapshot = runtime.getSnapshot();
    expect(snapshot.historySize).toBe(1);
  });

  it("config can be created with HTTPS enabled", () => {
    const config = createTestConfig({
      httpsEnabled: true,
      httpsKeyPath: "/path/to/key.pem",
      httpsCertPath: "/path/to/cert.pem",
    });

    expect(config.httpsEnabled).toBe(true);
    expect(config.httpsKeyPath).toBe("/path/to/key.pem");
    expect(config.httpsCertPath).toBe("/path/to/cert.pem");
  });
});
