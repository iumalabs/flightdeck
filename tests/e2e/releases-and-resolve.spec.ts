import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { getDsnKey } from "../contract/support/dsn-key.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "../contract/support/seed-actor.ts";

// spec.md User Story 2 (releases list -> detail) and User Story 3 (issue-resolve action), end to
// end through the actual UI.

function buildErrorEnvelope(eventId: string, uniqueTitle: string, release: string): string {
  const payload = JSON.stringify({
    event_id: eventId,
    level: "error",
    release,
    exception: {
      values: [{
        type: uniqueTitle,
        value: "seeded for releases-and-resolve.spec.ts",
        stacktrace: {
          frames: [{ filename: "checkout.js", function: "submitOrder", in_app: true }],
        },
      }],
    },
  });
  const bytes = new TextEncoder().encode(payload).length;
  return [
    JSON.stringify({ event_id: eventId }),
    JSON.stringify({ type: "event", length: bytes }),
    payload,
  ].join("\n");
}

test("releases list -> detail shows health figures; issue resolve/regression flow works end to end", async ({ browser, request, baseURL }) => {
  await ensureContractTestActor();
  const dsnKey = await getDsnKey();
  // Uses the shared seeded actor (not a fresh sub) — this flow writes audit_log entries (API
  // token generation, issue resolve), which requires actor_sub to reference an existing users
  // row (worker/db/migrations/0001_baseline.sql's FK; tests/contract/support/seed-actor.ts).
  const token = await mintTestSession({ ...CONTRACT_TEST_ACTOR, role: "member" });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();

  // Seed via the API-token surface (mirrors a real sentry-cli flow).
  const tokenRes = await request.post("/api/internal/projects/demo/api-tokens", {
    headers: { Cookie: `fd_session=${token}` },
  });
  const { token: apiToken } = await tokenRes.json() as { id: string; token: string };

  const version = `e2e-release-${crypto.randomUUID().slice(0, 8)}`;
  await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    data: { version, projects: ["demo"] },
  });

  const uniqueTitle = `e2e-resolve-${crypto.randomUUID().slice(0, 8)}`;
  const eventId = crypto.randomUUID();
  const ingest = await request.post(`/api/demo/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildErrorEnvelope(eventId, uniqueTitle, version),
  });
  expect(ingest.status()).toBe(200);

  await page.goto("/");
  await page.getByText("Releases", { exact: true }).click();
  const releaseRow = page.getByText(version);
  await expect(releaseRow).toBeVisible();
  await releaseRow.click();
  await expect(page.getByRole("heading", { name: version })).toBeVisible();

  // Resolve the seeded issue from its own detail view.
  await page.getByText("Issues", { exact: true }).click();
  const issueRow = page.getByText(new RegExp(`^${uniqueTitle}:`));
  await expect(issueRow).toBeVisible();
  await issueRow.click();
  await expect(page.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) })).toBeVisible();

  await page.getByText("Resolve", { exact: true }).click();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();

  // Back on the issues list, the resolved issue no longer appears in the default active view.
  await page.getByText("Issues", { exact: true }).click();
  await expect(page.getByText(new RegExp(`^${uniqueTitle}:`))).toHaveCount(0);

  await context.close();
});
