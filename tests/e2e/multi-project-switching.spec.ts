import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "../contract/support/seed-actor.ts";

// spec.md User Story 2, end to end through the actual UI: create a second project via Settings,
// switch to it, and confirm every project-scoped screen re-scopes — a brand-new project has zero
// rows anywhere, so an honest empty state (never demo's data) is exactly what proves the switch
// reached each screen's fetch(), not just the sidebar chip's own label.

test("creating a project via Settings surfaces its DSN, and switching to it shows empty states everywhere", async ({ browser, baseURL }) => {
  await ensureContractTestActor();
  const token = await mintTestSession({ ...CONTRACT_TEST_ACTOR, role: "member" });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await page.getByText("Settings", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const projectName = `e2e-switch-${crypto.randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder("Project name").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();

  // spec User Story 3 — the DSN renders inline, no separate navigation.
  await expect(page.getByText(/^DSN: https:\/\//)).toBeVisible();

  // spec FR-009 — the sidebar chip is a real switcher now that there's something to switch to
  // (this environment already has other, earlier-created non-demo projects from contract-test
  // runs against the same local D1, so this is always true here; the single-project plain-text
  // case is covered at the component level, not by forcing a single-project precondition against
  // shared state this suite doesn't own).
  const switcher = page.locator("select");
  await expect(switcher).toBeVisible();
  await switcher.selectOption({ label: projectName });

  const EMPTY_STATE_HEADINGS: Record<string, string> = {
    Issues: "No issues yet",
    Traces: "No traces yet",
    Releases: "No releases yet",
    Uptime: "No uptime checks yet",
    Feedback: "No feedback yet",
  };

  for (const [navLabel, emptyStateTitle] of Object.entries(EMPTY_STATE_HEADINGS)) {
    await page.getByText(navLabel, { exact: true }).click();
    await expect(page.getByText(emptyStateTitle)).toBeVisible();
  }

  // Logs has no shared EmptyState component (LogsScreen.tsx), but its live-tail tab's own
  // waiting-for-data copy is equally proof that no demo data leaked through.
  await page.getByText("Logs", { exact: true }).click();
  await expect(page.getByText("Waiting for log lines…")).toBeVisible();

  await context.close();
});
