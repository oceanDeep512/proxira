import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../src/config/env.js";
import { MemoryFileSystem } from "./helpers.js";

const load = (env: NodeJS.ProcessEnv) =>
  loadRuntimeConfig(env, new MemoryFileSystem());

describe("loadRuntimeConfig", () => {
  it("falls back to defaults for empty environment variables", () => {
    // An empty value means "not set". Number("") === 0 used to collapse these
    // into 1 (history capped at a single record, bodies clipped to 1 byte).
    const config = load({
      PROXY_HISTORY_LIMIT: "",
      PROXY_MAX_BODY_CAPTURE_BYTES: "",
      PROXY_UPSTREAM_TIMEOUT_MS: "",
      PROXY_HISTORY_PERSIST_LIMIT: "",
    });

    expect(config.historyLimit).toBe(1_000);
    expect(config.maxBodyCaptureBytes).toBe(2 * 1024 * 1024);
    expect(config.upstreamTimeoutMs).toBe(30_000);
    expect(config.historyPersistLimit).toBe(200);
  });

  it("also treats whitespace-only values as unset", () => {
    const config = load({ PROXY_HISTORY_LIMIT: "   " });
    expect(config.historyLimit).toBe(1_000);
  });

  it("still honours real values, including 0 for the unbounded knobs", () => {
    const config = load({
      PROXY_HISTORY_LIMIT: "42",
      PROXY_STREAM_MAX_CAPTURE_BYTES: "0",
      PROXY_STREAM_MAX_CAPTURE_MS: "0",
    });
    expect(config.historyLimit).toBe(42);
    expect(config.streamMaxCaptureBytes).toBe(0);
    expect(config.streamMaxCaptureMs).toBe(0);
  });

  it("falls back for garbage values", () => {
    const config = load({ PROXY_HISTORY_LIMIT: "abc" });
    expect(config.historyLimit).toBe(1_000);
  });
});
