import type { Hono } from "hono";
import { DashboardAssets } from "../dashboard/assets.js";
import type { RuntimeConfig } from "../app/types.js";

export const registerDashboardRoutes = (
  app: Hono,
  deps: { config: RuntimeConfig; dashboard: DashboardAssets },
): void => {
  const uiRoot = `${deps.config.internalRoutePrefix}/ui`;

  app.get(uiRoot, (c) => c.redirect(`${uiRoot}/`));
  app.get(`${uiRoot}/*`, async (c) => {
    return deps.dashboard.serve(c.req.path);
  });
};
