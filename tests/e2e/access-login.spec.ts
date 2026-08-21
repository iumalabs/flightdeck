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

test("GET /api/internal/me without a session is rejected, fail closed", async ({ request }) => {
  const response = await request.get("/api/internal/me");
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
