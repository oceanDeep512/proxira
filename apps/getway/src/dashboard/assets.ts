import { extname, join } from "node:path";
import type { FileSystemAdapter, RuntimeConfig } from "../app/types.js";

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

export class DashboardAssets {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly fs: FileSystemAdapter,
  ) {}

  get dashboardDistDir(): string | null {
    return this.config.dashboardDistDir;
  }

  getDashboardUrl(port: number): string {
    const protocol = this.config.httpsEnabled ? "https" : "http";
    return `${protocol}://localhost:${port}${this.config.internalRoutePrefix}/ui`;
  }

  async serve(requestPath: string): Promise<Response> {
    if (!this.config.dashboardDistDir) {
      return Response.json(
        {
          message:
            "Dashboard build not found. Run `pnpm --filter @proxira/dashboard build` first.",
        },
        { status: 503 },
      );
    }

    const filePath = this.resolveAssetPath(requestPath);
    if (!filePath || !this.fs.existsSync(filePath)) {
      return Response.json({ message: "Not Found" }, { status: 404 });
    }

    const fileBuffer = await this.fs.readBinaryFile(filePath);
    const contentType =
      MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    const safeBuffer = new Uint8Array(fileBuffer.byteLength);
    safeBuffer.set(fileBuffer);

    return new Response(new Blob([safeBuffer]), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": filePath.endsWith(".html")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      },
    });
  }

  private resolveAssetPath(requestPath: string): string | null {
    const dashboardDistDir = this.config.dashboardDistDir;
    if (!dashboardDistDir) {
      return null;
    }

    const normalized = requestPath
      .replace(new RegExp(`^${this.config.internalRoutePrefix}/ui/?`), "")
      .replace(/^\/+/, "");
    if (normalized.includes("..")) {
      return null;
    }

    if (normalized.length === 0) {
      return join(dashboardDistDir, "index.html");
    }

    const filePath = join(dashboardDistDir, normalized);
    if (this.fs.existsSync(filePath)) {
      return filePath;
    }
    if (extname(normalized).length > 0) {
      return null;
    }

    return join(dashboardDistDir, "index.html");
  }
}
