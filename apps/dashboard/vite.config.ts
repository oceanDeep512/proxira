import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 生产构建挂载在 /_proxira/ui/ 下（由 getway 的 dashboard 路由托管），
// 开发时走根路径并代理 /_proxira 到本机服务。
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === "build" ? "/_proxira/ui/" : "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/_proxira": {
        target: process.env.VITE_PROXY_DEV_TARGET ?? "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
}));
