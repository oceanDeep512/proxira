import { Hono } from "hono";
import { cors } from "hono/cors";
import { AppError } from "../shared/errors.js";
import type { RuntimeConfig, RuntimeStatusFactory } from "./types.js";
import { RuntimeStore } from "./runtime-store.js";
import { DashboardAssets } from "../dashboard/assets.js";
import { ProxyService } from "../proxy/service.js";
import { createInternalApiRouter } from "../routes/internal-api.js";
import { registerDashboardRoutes } from "../routes/dashboard.js";
import { registerProxyRoutes } from "../routes/proxy.js";

export const createApp = (deps: {
  config: RuntimeConfig;
  runtime: RuntimeStore;
  dashboard: DashboardAssets;
  proxyService: ProxyService;
  getStatus: RuntimeStatusFactory;
  logger: Pick<Console, "error">;
}): Hono => {
  const app = new Hono();
  app.use(`${deps.config.internalRoutePrefix}/*`, cors());
  app.route(
    deps.config.internalRoutePrefix,
    createInternalApiRouter({
      config: deps.config,
      runtime: deps.runtime,
      getStatus: deps.getStatus,
    }),
  );
  registerDashboardRoutes(app, {
    config: deps.config,
    dashboard: deps.dashboard,
  });
  registerProxyRoutes(app, {
    config: deps.config,
    proxyService: deps.proxyService,
  });

  app.notFound((c) => {
    return Response.json({ message: "Not Found" }, { status: 404 });
  });

  app.onError((error, c) => {
    deps.logger.error(error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AppError) {
      return Response.json({ message: error.message }, { status: error.status });
    }
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  });

  return app;
};
