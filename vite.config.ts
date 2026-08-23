import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// issues/25 — read once at build time, not shipped as a runtime fetch, so the sidebar version
// label stays correct across releases without a manual edit (release-please is what keeps this
// file itself in sync, per release-please-config.json's version-file).
const APP_VERSION = Deno.readTextFileSync(new URL("./VERSION", import.meta.url)).trim();

export default defineConfig({
  root: "app",
  plugins: [react(), cloudflare()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
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
