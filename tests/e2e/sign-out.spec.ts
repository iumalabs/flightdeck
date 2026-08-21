import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";

// spec.md User Story 3, AC3: signing out ends the session such that the next visit to an
// authenticated area requires signing in again — not just a client-side state flip, since
// fd_session is HttpOnly and can only be cleared via POST /logout (research.md §3 correction).

test("sign out returns to the marketing site and re-gates the app shell", async ({ browser, baseURL }) => {
  const token = await mintTestSession({
    sub: "e2e-signout-1",
    email: "signout-user@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.getByText("signout-user@example.com").first()).toBeVisible();

  await page.getByText("Sign out", { exact: true }).click();

  // Back on the marketing site.
  await expect(page.getByRole("heading", { name: /Every instrument\./ })).toBeVisible();

  // The server-side session is actually gone, not just locally forgotten — reloading (a real
  // request, not client-routed state) still shows the marketing site rather than the app shell.
  await page.reload();
  await expect(page.getByRole("heading", { name: /Every instrument\./ })).toBeVisible();
  await expect(page.getByText("signout-user@example.com")).toHaveCount(0);

  await context.close();
});

test("visiting an app-shell URL with no session opens the sign-in flow", async ({ page }) => {
  await page.goto("/web-app/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
