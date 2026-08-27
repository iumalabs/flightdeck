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

// T050 (specs/002-error-monitoring Phase 8 Convergence) — simulates retention having pruned an
// issue's only event by deleting its `events` row directly against the local preview D1 (same
// out-of-band-D1-manipulation technique tests/contract/support/seed-actor.ts uses), rather than
// waiting on/re-exercising the actual retention cron job (already covered by
// tests/unit/retention.test.ts).
async function deleteEventsForIssue(issueId: string): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "npm:wrangler",
      "d1",
      "execute",
      "flightdeck-preview",
      "--local",
      "--env",
      "preview",
      "--command",
      `DELETE FROM events WHERE issue_id = '${issueId}'`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stderr } = await command.output();
  if (!success) {
    throw new Error(
      `wrangler d1 execute (delete events) failed: ${new TextDecoder().decode(stderr)}`,
    );
  }
}

async function findIssueIdByTitle(
  request: import("@playwright/test").APIRequestContext,
  cookie: string,
  title: string,
): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const res = await request.get(`/api/internal/v1/issues?project=1&status=all`, {
      headers: { Cookie: cookie },
    });
    const { issues } = await res.json() as { issues: { id: string; title: string }[] };
    const found = issues.find((iss) => iss.title.includes(title));
    if (found) return found.id;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`issue with title containing "${title}" never appeared`);
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
  const ingest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
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

  // issue #120 — the same row/back-link must also be reachable and operable from the keyboard
  // alone (no click): focus each element directly and activate it with Enter.
  const issueRowButton = page.locator('[role="button"]').filter({ hasText: uniqueTitle });
  await issueRowButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) })).toBeVisible();

  const backToIssuesLink = page.getByText("← Back to Issues");
  await backToIssuesLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();

  await context.close();
});

// T050 (specs/002-error-monitoring Phase 8 Convergence) — an issue whose only event aged out under
// retention must show a distinct, explicit notice, not the same "No stack trace recorded" /
// "No breadcrumbs recorded" text a genuinely-empty event would show.
test("an issue whose only event was pruned by retention shows a retention notice, not a generic empty state", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const eventId = crypto.randomUUID();
  const uniqueTitle = `e2e-retention-${eventId}`;

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
  const ingest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: body,
  });
  expect(ingest.status()).toBe(200);

  const token = await mintTestSession({
    sub: "e2e-issues-retention",
    email: "issues-retention@example.com",
    role: "member",
  });
  const cookie = `fd_session=${token}`;
  const issueId = await findIssueIdByTitle(request, cookie, uniqueTitle);

  // Simulate the retention job having pruned this issue's only event — the `issues` aggregate row
  // (and its event_count) is left untouched, matching pruneOldEvents' actual behavior.
  await deleteEventsForIssue(issueId);

  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await page.getByText("Issues", { exact: true }).click();
  const issueRow = page.getByText(new RegExp(`^${uniqueTitle}:`));
  await expect(issueRow).toBeVisible();
  await issueRow.click();

  await expect(page.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) })).toBeVisible();
  await expect(page.getByText("Detailed event data is no longer retained for this issue."))
    .toHaveCount(2); // once under Stack trace, once under Breadcrumbs
  await expect(page.getByText("No stack trace recorded for this event.")).toHaveCount(0);
  await expect(page.getByText("No breadcrumbs recorded.")).toHaveCount(0);

  await context.close();
});
