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
