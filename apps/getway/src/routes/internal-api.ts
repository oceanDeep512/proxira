import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { RuntimeStore } from "../app/runtime-store.js";
import type { ProxyService } from "../proxy/service.js";
import type { RuntimeConfig, RuntimeStatusFactory } from "../app/types.js";

type ValidationIssue = {
  path?: ReadonlyArray<PropertyKey> | undefined;
  message?: string | undefined;
};

const readIssues = (error: unknown): ValidationIssue[] => {
  if (!error || typeof error !== "object") {
    return [];
  }
  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as ValidationIssue[]) : [];
};

// Surface the validation detail instead of a blanket "Invalid request.": a
// renamed wire key only ever shows up here, and a generic message turns a
// five-second diagnosis into a long hunt.
const validationHook = (
  result: { success: boolean; error?: unknown },
  c: { json: (payload: unknown, status?: number) => Response },
) => {
  if (!result.success) {
    const detail = readIssues(result.error)
      .map((issue) => {
        if (!issue.message) {
          return "";
        }
        const path = (issue.path ?? []).map(String).join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .filter(Boolean)
      .join("; ");
    return c.json(
      { message: detail ? `Invalid request: ${detail}` : "Invalid request." },
      400,
    );
  }
};

const configUpdateSchema = z
  .object({
    activeGroupId: z.string().optional(),
    targetBaseUrl: z.string().optional(),
  })
  .refine(
    (value) =>
      typeof value.activeGroupId === "string" ||
      typeof value.targetBaseUrl === "string",
    { message: "activeGroupId or targetBaseUrl is required." },
  );

const createGroupSchema = z.object({
  name: z.string().trim().min(1),
  targetBaseUrl: z.string().trim().min(1),
  switchToNew: z.boolean().optional(),
  upstreamTimeoutMs: z.number().int().positive().nullable().optional(),
});

const updateGroupSchema = z
  .object({
    name: z.string().optional(),
    targetBaseUrl: z.string().optional(),
    makeActive: z.boolean().optional(),
    upstreamTimeoutMs: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (value) =>
      typeof value.name === "string" ||
      typeof value.targetBaseUrl === "string" ||
      typeof value.makeActive === "boolean" ||
      value.upstreamTimeoutMs !== undefined,
    { message: "name, targetBaseUrl, makeActive or upstreamTimeoutMs is required." },
  );

const recordsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  method: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  groupId: z.string().trim().min(1).optional(),
});

const exportQuerySchema = z.object({
  method: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  groupId: z.string().trim().min(1).optional(),
});

const groupIdQuerySchema = z.object({
  groupId: z.string().trim().min(1).optional(),
});

const ruleActionSchema = z.enum([
  "mock",
  "error",
  "delay",
  "break_stream",
  "truncate",
]);

const ruleInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  matchPath: z.string().trim().min(1).optional(),
  matchMethod: z.string().trim().min(1).nullable().optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  action: ruleActionSchema.optional(),
  status: z.number().int().min(100).max(599).optional(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  body: z.string().optional(),
  stream: z.boolean().optional(),
  chunkIntervalMs: z.number().int().min(0).max(10_000).optional(),
  message: z.string().optional(),
  afterChunks: z.number().int().min(0).max(10_000).optional(),
  keepBytes: z.number().int().min(0).max(100 * 1024 * 1024).optional(),
});

const createRuleSchema = ruleInputSchema.refine(
  (value) => Object.keys(value).length > 0,
  { message: "at least one rule field is required." },
);

const replaySchema = z.object({
  recordId: z.string().trim().min(1).optional(),
  method: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});

export const createInternalApiRouter = (deps: {
  config: RuntimeConfig;
  runtime: RuntimeStore;
  proxyService: ProxyService;
  getStatus: RuntimeStatusFactory;
}): Hono => {
  const router = new Hono().basePath("/api");

  router.get("/health", (c) => {
    return c.json({ ok: true, at: new Date().toISOString() });
  });

  router.get("/status", (c) => {
    return c.json(deps.getStatus());
  });

  router.get("/config", (c) => {
    return c.json(deps.runtime.getConfig());
  });

  router.put(
    "/config",
    zValidator("json", configUpdateSchema, validationHook),
    (c) => {
      return c.json(deps.runtime.updateConfig(c.req.valid("json")));
    },
  );

  router.post(
    "/groups",
    zValidator("json", createGroupSchema, validationHook),
    (c) => {
      return c.json(deps.runtime.createGroupEntry(c.req.valid("json")), 201);
    },
  );

  router.put(
    "/groups/:id",
    zValidator("json", updateGroupSchema, validationHook),
    (c) => {
      return c.json(
        deps.runtime.updateGroupEntry(c.req.param("id"), c.req.valid("json")),
      );
    },
  );

  router.delete("/groups/:id", (c) => {
    return c.json(deps.runtime.deleteGroupEntry(c.req.param("id")));
  });

  router.post("/reset", (c) => {
    return c.json(deps.runtime.resetAll());
  });

  router.get(
    "/records",
    zValidator("query", recordsQuerySchema, validationHook),
    (c) => {
      const query = c.req.valid("query");
      return c.json(
        deps.runtime.listRecords({
          groupId: query.groupId,
          method: query.method?.toUpperCase(),
          path: query.path,
          status: query.status,
          limit: Math.min(query.limit ?? 50, deps.config.maxQueryLimit),
          offset: query.offset ?? 0,
        }),
      );
    },
  );

  router.get(
    "/records/export",
    zValidator("query", exportQuerySchema, validationHook),
    (c) => {
      const query = c.req.valid("query");
      const payload = deps.runtime.exportRecords({
        groupId: query.groupId,
        method: query.method?.toUpperCase(),
        path: query.path,
        status: query.status,
      });
      return new Response(JSON.stringify(payload, null, 2), {
        headers: deps.runtime.buildExportHeaders(payload),
      });
    },
  );

  router.get(
    "/records/:id",
    zValidator("query", groupIdQuerySchema, validationHook),
    (c) => {
      const payload = deps.runtime.getRecord(
        c.req.valid("query").groupId,
        c.req.param("id"),
      );
      if (!payload.item) {
        return c.json(payload, 404);
      }
      return c.json(payload);
    },
  );

  router.delete(
    "/records/:id",
    zValidator("query", groupIdQuerySchema, validationHook),
    (c) => {
      const payload = deps.runtime.deleteRecord(
        c.req.valid("query").groupId,
        c.req.param("id"),
      );
      return c.json(payload, payload.removed ? 200 : 404);
    },
  );

  router.delete(
    "/records",
    zValidator("query", groupIdQuerySchema, validationHook),
    (c) => {
      return c.json(deps.runtime.clearRecords(c.req.valid("query").groupId));
    },
  );

  router.get(
    "/rules",
    zValidator("query", groupIdQuerySchema, validationHook),
    (c) => {
      return c.json(deps.runtime.listRules(c.req.valid("query").groupId));
    },
  );

  router.post(
    "/rules",
    zValidator("json", createRuleSchema, validationHook),
    (c) => {
      const payload = c.req.valid("json");
      const groupId = typeof c.req.query("groupId") === "string"
        ? c.req.query("groupId")
        : undefined;
      return c.json(deps.runtime.createRuleEntry(groupId, payload), 201);
    },
  );

  router.put("/rules/:id", zValidator("json", ruleInputSchema, validationHook), (c) => {
    const updated = deps.runtime.updateRuleEntry(
      c.req.param("id"),
      c.req.valid("json"),
    );
    if (!updated) {
      return c.json({ message: "rule not found." }, 404);
    }
    return c.json(updated);
  });

  router.delete("/rules/:id", (c) => {
    const removed = deps.runtime.deleteRuleEntry(c.req.param("id"));
    return c.json(removed, removed.removed ? 200 : 404);
  });

  // Re-issue a recorded request (optionally edited) against the upstream, so a
  // failing call can be reproduced with one click.
  router.post(
    "/replay",
    zValidator("json", replaySchema, validationHook),
    async (c) => {
      return c.json(await deps.proxyService.replay(c.req.valid("json")));
    },
  );

  router.get("/events", (c) => {
    return deps.runtime.createEventsResponse(c.req.raw.signal);
  });

  return router;
};
