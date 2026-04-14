import type { Context, Hono } from "hono";
import { ProxyService } from "../proxy/service.js";
import type { RuntimeConfig } from "../app/types.js";

export const registerProxyRoutes = (
  app: Hono,
  deps: { config: RuntimeConfig; proxyService: ProxyService },
): void => {
  const handler = async (c: Context) => {
    const response = await deps.proxyService.forward(c.req.raw);
    if (!response) {
      return c.json({ message: "Not Found" }, 404);
    }
    return response;
  };

  if (deps.config.proxyPrefixEnabled) {
    app.all(deps.config.proxyPrefix, handler);
    app.all(`${deps.config.proxyPrefix}/*`, handler);
    return;
  }

  app.all("*", handler);
};
