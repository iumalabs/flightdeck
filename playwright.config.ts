import { defineConfig, devices } from "@playwright/test";
import { E2E_API_TOKEN_PEPPER, E2E_SESSION_SECRET } from "./tests/e2e/support/constants.ts";

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
    // FR-002 requires — `--env preview` so the preview D1 binding/vars are available. SESSION_SECRET
    // is declared as a required *secret* (constitution Principle IX) so it's deliberately absent
    // from wrangler.jsonc/committed config; CI has no `.dev.vars` file (gitignored), so it's passed
    // here instead — a fixed, e2e-only value, never a real credential — matching the constant
    // tests/e2e/support/session.ts uses to mint pre-authenticated cookies. API_TOKEN_PEPPER (T047,
    // specs/005-releases) is passed the same way — releases-and-resolve.spec.ts exercises the
    // API-token release-management flow, which requires the pepper to be bound.
    command:
      `deno run -A npm:vite build && deno run -A npm:wrangler dev --port 8787 --env preview --var SESSION_SECRET:${E2E_SESSION_SECRET} --var API_TOKEN_PEPPER:${E2E_API_TOKEN_PEPPER}`,
    port: 8787,
    reuseExistingServer: !Deno.env.get("CI"),
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
