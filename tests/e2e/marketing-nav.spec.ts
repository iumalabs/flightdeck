import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";

// spec.md User Story 1: an unauthenticated visitor can read the whole marketing site via
// client-side navigation, and every page also renders correctly on a direct/deep-link visit.

test("navigates the marketing site without a full page reload and without ever prompting for login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Every instrument\./ })).toBeVisible();

  const primaryNav = page.getByRole("navigation", { name: "Primary" });

  await primaryNav.getByText("Product", { exact: true }).click();
  await expect(page).toHaveURL(/\/product$/);
  await expect(page.getByRole("heading", { name: "Six instruments, one signal chain" }))
    .toBeVisible();

  await primaryNav.getByText("Docs", { exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();

  await primaryNav.getByText("Self-hosting", { exact: true }).click();
  await expect(page).toHaveURL(/\/self-hosting$/);
  await expect(page.getByRole("heading", { name: "Your data, your infrastructure" })).toBeVisible();

  await primaryNav.getByText("Changelog", { exact: true }).click();
  await expect(page).toHaveURL(/\/changelog$/);
  await expect(page.getByRole("heading", { name: "What shipped" })).toBeVisible();

  // Never prompted for login while wandering the marketing site.
  await expect(page.getByText("Continue with Cloudflare Access")).toHaveCount(0);
});

test("renders a deep-linked marketing page directly, without going through Home first", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();
  await expect(page.getByText("Quickstart").first()).toBeVisible();
});

// Regression test for issue #57: App.tsx used to render the app shell for EVERY pathname whenever
// a session existed, so a signed-in user could never actually reach /docs, /changelog, /product or
// /self-hosting — the app shell's Overview screen rendered instead while the URL bar still showed
// the requested marketing path. Marketing pathnames must stay reachable regardless of session.
test("an authenticated session can still reach the public marketing pages, with a way back into the app shell", async ({ browser, baseURL }) => {
  const token = await mintTestSession({
    sub: "e2e-marketing-authed",
    email: "marketing-authed@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();

  // Direct navigation (deep link), not a click-through from Home — the exact repro from #57.
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();
  await expect(page.getByText("Quickstart").first()).toBeVisible();
  // The app shell (Overview) must NOT have silently rendered instead.
  await expect(page.getByText(/^Welcome,/)).toHaveCount(0);

  await page.goto("/changelog");
  await expect(page.getByRole("heading", { name: "What shipped" })).toBeVisible();

  // The nav's login CTA doubles as the way back in once authenticated (no forced sign-out).
  const ctaButton = page.getByText("Open app →", { exact: true });
  await expect(ctaButton).toBeVisible();
  await ctaButton.click();
  await expect(page).toHaveURL(/\/web-app$/);
  await expect(page.getByText("marketing-authed@example.com").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible();

  await context.close();
});
