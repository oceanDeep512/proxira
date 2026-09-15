import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  base: command === 'build' ? '/_proxira/ui/' : '/',
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      '/_proxira': {
        target: process.env.VITE_PROXY_DEV_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
}))
