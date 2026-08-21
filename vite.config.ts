import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  root: "app",
  plugins: [react(), cloudflare()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  server: {
    fs: {
      // Vite's default fs.allow is derived from `root` ("app/"), which excludes the repo-root
      // node_modules/ — Deno's npm-compat layer nests packages one level above `app/`. Without
      // this, the self-hosted @fontsource font requests are silently blocked by Vite's dev server
      // (see FlareTower's vite.config.ts for the same fix and how it was discovered).
      allow: [".."],
    },
  },
});
