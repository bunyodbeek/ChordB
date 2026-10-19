import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Reached through an HTTPS tunnel (cloudflared / ngrok) when testing inside Telegram.
    allowedHosts: true,
    proxy: {
      // Same layout as prod, where Nginx serves the build and proxies /api.
      "/api": "http://127.0.0.1:8001",
    },
  },
});
