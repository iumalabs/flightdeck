import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { getDsnKey } from "../contract/support/dsn-key.ts";

// spec.md User Story 1 (real ingest) + User Story 2 (issue detail) navigation, end to end through
// the actual UI: seeds one real issue via the public envelope endpoint (same D1 the e2e webServer
// serves — research.md's testing rationale), then drives the issues list -> issue detail -> back
// flow through a real browser, pre-authenticated (Module 1's pattern).

function buildEnvelope(eventId: string, payload: Record<string, unknown>): string {
  const eventJson = JSON.stringify({ event_id: eventId, ...payload });
  const payloadBytes = new TextEncoder().encode(eventJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "event", length: payloadBytes });
  return [envelopeHeader, itemHeader, eventJson].join("\n");
}

test("navigating from the issues list into an issue's detail and back", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const eventId = crypto.randomUUID();
  const uniqueTitle = `e2e-nav-${eventId}`;

  const body = buildEnvelope(eventId, {
    level: "error",
    exception: {
      values: [{
        type: uniqueTitle,
        value: "seeded for issues-list-and-detail.spec.ts",
        stacktrace: {
          frames: [{ filename: "checkout.js", function: "submitOrder", in_app: true }],
        },
      }],
    },
  });
  const ingest = await request.post(`/api/demo/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: body,
  });
  expect(ingest.status()).toBe(200);

  const token = await mintTestSession({
    sub: "e2e-issues-nav",
    email: "issues-nav@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await page.getByText("Issues", { exact: true }).click();
  const issueRow = page.getByText(new RegExp(`^${uniqueTitle}:`));
  await expect(issueRow).toBeVisible();
  await issueRow.click();

  await expect(page.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) })).toBeVisible();
  await expect(page.getByText(/submitOrder — checkout\.js/)).toBeVisible();

  await page.getByText("← Back to Issues").click();
  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
  await expect(issueRow).toBeVisible();

  await context.close();
});
