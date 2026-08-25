import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";

// spec.md User Story 3: every sidebar destination renders a distinct, honest empty state — none
// of the design mockup's sample issues/traces/logs data.

const DESTINATIONS: Array<{ label: string; heading: string }> = [
  { label: "Overview", heading: "Welcome," },
  { label: "Issues", heading: "Issues" },
  { label: "Traces", heading: "Traces" },
  { label: "Logs", heading: "Logs" },
  { label: "Releases", heading: "Releases" },
  { label: "Uptime", heading: "Uptime" },
  { label: "Feedback", heading: "Feedback" },
  { label: "Alerts", heading: "Alerts" },
  { label: "Settings", heading: "Settings" },
  { label: "Install SDK", heading: "Install SDK" },
];

test("every sidebar destination renders a distinct empty state, no mock data", async ({ browser, baseURL }) => {
  const token = await mintTestSession({
    sub: "e2e-shell-1",
    email: "shell-user@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  for (const destination of DESTINATIONS) {
    await page.getByText(destination.label, { exact: true }).click();
    await expect(page.getByRole("heading", { name: new RegExp(destination.heading) }))
      .toBeVisible();
  }

  // None of the design mockup's sample data ever appears as if it were real.
  await expect(page.getByText("TypeError: Cannot read properties of undefined")).toHaveCount(0);
  await expect(page.getByText("12.4k")).toHaveCount(0);

  await context.close();
});

test("the user menu shows the signed-in identity", async ({ browser, baseURL }) => {
  const token = await mintTestSession({
    sub: "e2e-shell-2",
    email: "menu-user@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await expect(page.getByText("menu-user@example.com").first()).toBeVisible();

  await context.close();
});

// Regression test for issue #58: AppShell's active screen used to be pure local React state
// (always initialized to "overview", only ever changed by sidebar onClick handlers), completely
// disconnected from the URL. A sidebar click now also pushes a matching /web-app/<screen> URL, and
// the screen is (re-)derived from the URL on mount and on every pathname change (popstate
// included) — so both directions of the sync are covered here.

test("clicking a sidebar link updates the URL, and the URL survives a reload", async ({ browser, baseURL }) => {
  const token = await mintTestSession({
    sub: "e2e-shell-deeplink-1",
    email: "deeplink-user-1@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible();

  await page.getByText("Issues", { exact: true }).click();
  await expect(page).toHaveURL(/\/web-app\/issues$/);
  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();

  // A full reload at that URL (not a client-routed click) must still land on Issues, not Overview.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toHaveCount(0);

  await context.close();
});

test("a direct navigation (deep link) to a /web-app/* sub-route renders that screen, not Overview", async ({ browser, baseURL }) => {
  const token = await mintTestSession({
    sub: "e2e-shell-deeplink-2",
    email: "deeplink-user-2@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();

  // Never visited "/" first — this is a bookmark/shared-link-style hard load straight at the
  // sub-route, the exact repro from issue #58.
  await page.goto("/web-app/issues");

  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toHaveCount(0);

  await context.close();
});

test("browser back navigation after a sidebar click restores the previous screen", async ({ browser, baseURL }) => {
  const token = await mintTestSession({
    sub: "e2e-shell-deeplink-3",
    email: "deeplink-user-3@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible();

  await page.getByText("Traces", { exact: true }).click();
  await expect(page).toHaveURL(/\/web-app\/traces$/);
  await expect(page.getByRole("heading", { name: "Traces", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible();

  await context.close();
});
