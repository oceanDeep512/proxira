import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { RuntimeStore } from "../app/runtime-store.js";
import type { ProxyService } from "../proxy/service.js";
import type { RuntimeConfig, RuntimeStatusFactory } from "../app/types.js";
import { AppError } from "../shared/errors.js";

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

// Header names / prefixes and protected-name rejection are enforced in
// headers/utils so hydration and the API share one rule set; here we only
// describe the shape.
const headerEntrySchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string(),
  value: z.string(),
});

const headerRuleSchema = z.object({
  id: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  namePrefix: z.string(),
  action: z.enum(["set", "ignore"]),
  value: z.string().optional(),
});

const headerConfigSchema = {
  customHeaders: z.array(headerEntrySchema).max(100).optional(),
  headerRules: z.array(headerRuleSchema).max(100).optional(),
};

const idListSchema = z.array(z.string().trim().min(1)).max(100).optional();

const createGroupSchema = z.object({
  name: z.string().trim().min(1),
  targetBaseUrl: z.string().trim().min(1),
  switchToNew: z.boolean().optional(),
  upstreamTimeoutMs: z.number().int().positive().nullable().optional(),
  ...headerConfigSchema,
  headerPresetIds: idListSchema,
  mockGroupIds: idListSchema,
});

const updateGroupSchema = z
  .object({
    name: z.string().optional(),
    targetBaseUrl: z.string().optional(),
    makeActive: z.boolean().optional(),
    upstreamTimeoutMs: z.number().int().positive().nullable().optional(),
    ...headerConfigSchema,
    headerPresetIds: idListSchema,
    mockGroupIds: idListSchema,
  })
  .refine(
    (value) =>
      typeof value.name === "string" ||
      typeof value.targetBaseUrl === "string" ||
      typeof value.makeActive === "boolean" ||
      value.upstreamTimeoutMs !== undefined ||
      value.customHeaders !== undefined ||
      value.headerRules !== undefined ||
      value.headerPresetIds !== undefined ||
      value.mockGroupIds !== undefined,
    {
      message:
        "name, targetBaseUrl, makeActive, upstreamTimeoutMs, headers or groups is required.",
    },
  );

// Header presets and mock groups are saved as a whole (the dashboard keeps the
// full list in its store), so the schemas mirror the persisted shape rather
// than offering one endpoint per row.
const presetSchema = z.object({
  name: z.string().trim().min(1).optional(),
  customHeaders: z.array(headerEntrySchema).max(100).optional(),
  headerRules: z.array(headerRuleSchema).max(100).optional(),
});

const createPresetSchema = z.object({
  name: z.string().trim().min(1),
  ...headerConfigSchema,
});

const mockRuleSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  matchPath: z.string().trim().min(1).optional(),
  matchMethod: z.string().trim().min(1).nullable().optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  status: z.number().int().min(100).max(599).optional(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  body: z.string().optional(),
  stream: z.boolean().optional(),
  chunkIntervalMs: z.number().int().min(0).max(10_000).optional(),
});

const mockGroupSchema = z.object({
  name: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  rules: z.array(mockRuleSchema).max(100).optional(),
});

const createMockGroupSchema = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  rules: z.array(mockRuleSchema).max(100).optional(),
});

const moveSchema = z.object({ direction: z.enum(["up", "down"]) });

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
  useCustomHeaders: z.boolean().optional(),
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

  router.get("/header-presets", (c) => {
    return c.json({ items: deps.runtime.listHeaderPresets() });
  });

  router.post(
    "/header-presets",
    zValidator("json", createPresetSchema, validationHook),
    (c) => {
      return c.json(deps.runtime.createHeaderPreset(c.req.valid("json")), 201);
    },
  );

  router.put(
    "/header-presets/:id",
    zValidator("json", presetSchema, validationHook),
    (c) => {
      const updated = deps.runtime.updateHeaderPreset(
        c.req.param("id"),
        c.req.valid("json"),
      );
      if (!updated) {
        return c.json({ message: "header preset not found." }, 404);
      }
      return c.json(updated);
    },
  );

  router.delete("/header-presets/:id", (c) => {
    const removed = deps.runtime.deleteHeaderPreset(c.req.param("id"));
    return c.json(removed, removed.removed ? 200 : 404);
  });

  // Order matters: it decides which preset wins when two write the same header.
  router.post(
    "/header-presets/:id/move",
    zValidator("json", moveSchema, validationHook),
    (c) => {
      return c.json(
        deps.runtime.moveHeaderPreset(c.req.param("id"), c.req.valid("json").direction),
      );
    },
  );

  router.get("/mock-groups", (c) => {
    return c.json({ items: deps.runtime.listMockGroups() });
  });

  router.post(
    "/mock-groups",
    zValidator("json", createMockGroupSchema, validationHook),
    (c) => {
      return c.json(deps.runtime.createMockGroup(c.req.valid("json")), 201);
    },
  );

  router.put(
    "/mock-groups/:id",
    zValidator("json", mockGroupSchema, validationHook),
    (c) => {
      const updated = deps.runtime.updateMockGroup(c.req.param("id"), c.req.valid("json"));
      if (!updated) {
        return c.json({ message: "mock group not found." }, 404);
      }
      return c.json(updated);
    },
  );

  router.delete("/mock-groups/:id", (c) => {
    const removed = deps.runtime.deleteMockGroup(c.req.param("id"));
    return c.json(removed, removed.removed ? 200 : 404);
  });

  // Same reason as the presets: the order decides which group is asked first.
  router.post(
    "/mock-groups/:id/move",
    zValidator("json", moveSchema, validationHook),
    (c) => {
      return c.json(
        deps.runtime.moveMockGroup(c.req.param("id"), c.req.valid("json").direction),
      );
    },
  );

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

  // Open the on-disk data directory in the platform file manager. The path is
  // fixed to config.dataDir on purpose — never echo back a caller-supplied
  // path, or this becomes an arbitrary "open anything" endpoint.
  router.post("/open-folder", (c) => {
    const dir = deps.config.dataDir;
    const isWin = platform() === "win32";
    const cmd = isWin ? "explorer" : platform() === "darwin" ? "open" : "xdg-open";
    try {
      const result = spawnSync(cmd, [dir], { stdio: "ignore" });
      if (result.error) {
        throw result.error;
      }
      // explorer returns a non-zero exit code even on success, so on Windows
      // the absence of an error is the only reliable success signal.
      if (!isWin && result.status !== 0) {
        throw new AppError(500, `${cmd} 退出码 ${result.status}`);
      }
      return c.json({ ok: true, dir });
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : String(error);
      throw new AppError(500, `无法打开文件夹：${reason}`);
    }
  });

  router.get("/events", (c) => {
    return deps.runtime.createEventsResponse(c.req.raw.signal);
  });

  return router;
};
