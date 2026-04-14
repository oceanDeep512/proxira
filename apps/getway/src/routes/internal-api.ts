import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { RuntimeStore } from "../app/runtime-store.js";
import type { RuntimeConfig, RuntimeStatusFactory } from "../app/types.js";

const validationHook = (
  result: { success: boolean },
  c: { json: (payload: unknown, status?: number) => Response },
) => {
  if (!result.success) {
    return c.json({ message: "Invalid request." }, 400);
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
});

const updateGroupSchema = z
  .object({
    name: z.string().optional(),
    targetBaseUrl: z.string().optional(),
    makeActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      typeof value.name === "string" ||
      typeof value.targetBaseUrl === "string" ||
      typeof value.makeActive === "boolean",
    { message: "name, targetBaseUrl or makeActive is required." },
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

export const createInternalApiRouter = (deps: {
  config: RuntimeConfig;
  runtime: RuntimeStore;
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

  router.get("/events", (c) => {
    return deps.runtime.createEventsResponse(c.req.raw.signal);
  });

  return router;
};
