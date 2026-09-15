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

// Length-independent comparison so a wrong token does not leak length info
// through response timing on a exposed deployment.
const tokensMatch = (expected: string, provided: string): boolean => {
  if (expected.length !== provided.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
};

const readProvidedToken = (request: Request): string | null => {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const bearer = authorization.slice(7).trim();
    if (bearer) {
      return bearer;
    }
  }
  try {
    return new URL(request.url).searchParams.get("token");
  } catch {
    return null;
  }
};

const DASHBOARD_ASSET_PATTERN =
  /\.(?:js|mjs|css|map|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|json)$/i;

// The UI shell and its hashed bundles must load before the app can ever send a
// token, so they are served without one. Data-bearing endpoints are not exempt.
const isUnprotectedDashboardAsset = (path: string, internalRoutePrefix: string): boolean => {
  const uiRoot = `${internalRoutePrefix}/ui`;
  if (!path.startsWith(uiRoot)) {
    return false;
  }
  const rest = path.slice(uiRoot.length);
  return rest === "" || rest === "/" || DASHBOARD_ASSET_PATTERN.test(rest);
};

export const createApp = (deps: {
  config: RuntimeConfig;
  runtime: RuntimeStore;
  dashboard: DashboardAssets;
  proxyService: ProxyService;
  getStatus: RuntimeStatusFactory;
  logger: Pick<Console, "error">;
}): Hono => {
  const app = new Hono();
  // Registered before the routes so a wrong token never reaches handlers.
  // The dashboard shell (HTML + JS/CSS assets) is intentionally exempt: the
  // browser cannot attach a token to <script>/<link> requests, and the bundle
  // itself carries no traffic data. Everything that does (API + SSE) stays
  // protected, so an unauthenticated visitor only ever gets an empty UI.
  if (deps.config.accessToken) {
    app.use(`${deps.config.internalRoutePrefix}/*`, async (c, next) => {
      if (isUnprotectedDashboardAsset(c.req.path, deps.config.internalRoutePrefix)) {
        await next();
        return;
      }
      const provided = readProvidedToken(c.req.raw);
      if (!provided || !tokensMatch(deps.config.accessToken ?? "", provided)) {
        return Response.json({ message: "Unauthorized" }, { status: 401 });
      }
      await next();
    });
  }
  app.use(`${deps.config.internalRoutePrefix}/*`, cors());
  app.route(
    deps.config.internalRoutePrefix,
    createInternalApiRouter({
      config: deps.config,
      runtime: deps.runtime,
      proxyService: deps.proxyService,
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
