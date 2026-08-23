import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";

// spec.md User Story 2: real Cloudflare Access login. The external IdP challenge itself can't be
// driven in CI (research.md §5) — these tests cover everything FlightDeck's own code controls:
// the modal's real (non-simulated) link to /login, fail-closed behavior with no Access assertion,
// and — via a pre-authenticated context — that a valid fd_session lands the user in the app shell.

test("sign-in modal links to the real /login bounce path, not a simulated flow", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Log in", { exact: true }).click();

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const continueLink = page.getByRole("link", { name: /Continue with Cloudflare Access/ });
  await expect(continueLink).toHaveAttribute("href", "/login");
});

test("GET /login without a Cloudflare Access assertion is rejected, fail closed", async ({ request }) => {
  const response = await request.get("/login", { maxRedirects: 0 });
  expect(response.status()).toBe(403);
});

// Regression test for a bug confirmed live: Playwright's `request` fixture above issues a plain
// HTTP request, which never triggered it — only a REAL top-level browser navigation (the kind
// Cloudflare Access's own redirect back to /login performs) has `Sec-Fetch-Mode: navigate`, and
// Cloudflare's static-asset layer serves the SPA's index.html for such navigations to any
// unmatched path (not_found_handling: single-page-application) BEFORE the Worker itself runs,
// unless the path is listed in `assets.run_worker_first` (wrangler.jsonc). /login was missing
// from that list, so the real login flow silently landed back on the marketing homepage instead
// of ever reaching worker/auth/login-route.ts.
test("a real browser navigation to /login reaches the Worker, not the SPA fallback", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(403);
  await expect(page.getByText("Forbidden")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Every instrument\./ })).toHaveCount(0);
});

test("GET /api/internal/v1/me without a session is rejected, fail closed", async ({ request }) => {
  const response = await request.get("/api/internal/v1/me");
  expect(response.status()).toBe(403);
});

test("a valid fd_session lands the user in the app shell with their identity", async ({ browser, baseURL }) => {
  const token = await mintTestSession({
    sub: "e2e-user-1",
    email: "e2e-user@example.com",
    role: "member",
  });

  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "fd_session",
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();
  await page.goto("/");

  await expect(page.getByText("e2e-user@example.com").first()).toBeVisible();
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();

  await context.close();
});
