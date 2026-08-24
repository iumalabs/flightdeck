import { defineConfig } from "@playwright/test";
import { E2E_API_TOKEN_PEPPER, E2E_SESSION_SECRET } from "./tests/e2e/support/constants.ts";

// Separate from playwright.config.ts (which targets tests/e2e) because these tests hit the public
// ingest endpoint and the sessionAuth-gated source-map upload endpoint directly via
// request.post()/get(), not a browser — no `devices`/browser project needed, and a distinct port
// avoids colliding with an e2e run against the same preview D1. SESSION_SECRET is passed the same
// way playwright.config.ts's e2e webServer does (see that file's comment) — a fixed, contract-
// test-only value, never a real credential. API_TOKEN_PEPPER (T047, specs/005-releases) is passed
// the same way for the same reason — these tests mint and use real API tokens via the release
// module's apiTokenAuth middleware, which requires the pepper to be bound.
export default defineConfig({
  testDir: "./tests/contract",
  fullyParallel: false,
  // All specs share one DSN key's rate-limit window (see zz-rate-limit.spec.ts) — a single worker
  // guarantees deterministic file-by-file execution instead of relying on directory listing order.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8788",
  },
  webServer: {
    command:
      `deno run -A npm:wrangler dev --port 8788 --env preview --var SESSION_SECRET:${E2E_SESSION_SECRET} --var API_TOKEN_PEPPER:${E2E_API_TOKEN_PEPPER}`,
    port: 8788,
    reuseExistingServer: !Deno.env.get("CI"),
    timeout: 60_000,
  },
});
