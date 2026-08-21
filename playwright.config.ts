import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // "list" for local/CI console output; the HTML report is only written to disk (never
  // auto-opened, including locally) so CI has something to upload as an artifact for a failed
  // run's trace/screenshots.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8787",
  },
  webServer: {
    // Deliberately NOT `deno task dev` (raw `vite`) — confirmed live that the Cloudflare Vite
    // plugin's dev-mode asset serving does not apply `not_found_handling:
    // "single-page-application"` for a hard-navigated/reloaded nested path (e.g. GET /docs
    // 404s), while a real build served through `wrangler dev` correctly falls back to
    // index.html, matching production (Workers Builds) behavior. Building first and driving
    // e2e against `wrangler dev` is what actually exercises the SPA-fallback behavior spec
    // FR-002 requires — `--env preview` so the preview D1 binding/vars are available once
    // later modules add them.
    command: "deno run -A npm:vite build && deno run -A npm:wrangler dev --port 8787 --env preview",
    port: 8787,
    reuseExistingServer: !Deno.env.get("CI"),
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
