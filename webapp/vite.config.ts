import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Node's env without @types/node (this file is type-checked with the app).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Reached through an HTTPS tunnel (cloudflared / ngrok) when testing inside Telegram.
    allowedHosts: true,
    // Through a tunnel Vite's socket drops now and then, and the page reloads itself when it
    // reconnects: mid-game in Telegram. scripts/dev.sh turns the socket (and so HMR) off
    // when it runs a tunnel.
    ...(env.VITE_HMR === "off" ? { hmr: false, ws: false } : {}),
    proxy: {
      // Same layout as prod, where Nginx serves the build and proxies /api.
      "/api": "http://127.0.0.1:8001",
    },
  },
});
