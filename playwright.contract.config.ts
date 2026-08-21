import { defineConfig } from "@playwright/test";

// Separate from playwright.config.ts (which targets tests/e2e) because these tests hit the public
// ingest endpoint directly via request.post(), not a browser — no `devices`/browser project
// needed, and a distinct port avoids colliding with an e2e run against the same preview D1.
export default defineConfig({
  testDir: "./tests/contract",
  fullyParallel: false, // all tests share one DSN key's rate-limit window (see ingest-envelope.spec.ts)
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8788",
  },
  webServer: {
    command: "deno run -A npm:wrangler dev --port 8788 --env preview",
    port: 8788,
    reuseExistingServer: !Deno.env.get("CI"),
    timeout: 60_000,
  },
});
