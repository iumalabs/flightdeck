import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "../contract/support/seed-actor.ts";

// spec.md User Story 1 (checks run and report status), User Story 2 (incident-aware alerting), and
// User Story 3 (manual "test now" trigger), end to end through the actual UI — check creation
// writes audit_log (constitution Principle X), so this reuses the established seed-actor helper
// (specs/005-releases precedent) rather than Module 1's plain mintTestSession.

test("uptime check creation, manual trigger, and incident visibility across Uptime and Alerts", async ({ browser, baseURL }) => {
  await ensureContractTestActor();
  const token = await mintTestSession({
    sub: CONTRACT_TEST_ACTOR.sub,
    email: CONTRACT_TEST_ACTOR.email,
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  const uniqueName = `e2e-uptime-${crypto.randomUUID().slice(0, 8)}`;

  await page.getByText("Uptime", { exact: true }).click();
  await expect(page.getByText("Add a check")).toBeVisible();
  await page.getByPlaceholder("Name").fill(uniqueName);
  await page.getByPlaceholder("https://example.com", { exact: false }).fill("http://127.0.0.1:1");
  await page.getByRole("button", { name: "Add check" }).click();

  const checkRow = page.getByText(uniqueName);
  await expect(checkRow).toBeVisible();
  await checkRow.click();

  await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

  // Default failureThreshold is 3 (data-model.md) — three manual triggers against the
  // guaranteed-unreachable target should open exactly one incident (spec FR-007).
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Test this check now" }).click();
    await expect(page.getByText(/down —/)).toBeVisible();
  }

  await expect(page.getByText("open").first()).toBeVisible();

  await page.getByText("Alerts", { exact: true }).click();
  const alertRow = page.getByText(uniqueName);
  await expect(alertRow).toBeVisible();
  await expect(page.getByText("open").first()).toBeVisible();

  await alertRow.click();
  await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

  await context.close();
});
