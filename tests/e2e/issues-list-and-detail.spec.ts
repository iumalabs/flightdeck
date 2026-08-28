import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { getDsnKey } from "../contract/support/dsn-key.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "../contract/support/seed-actor.ts";

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

// issues #128/#129/#130/#132 — regressed, environment, user, and contexts are all captured and
// returned by the API already; this exercises the whole "captured -> surfaced in the UI" path in
// one flow: an issue seeded with environment/user/contexts on its first event (checked on both the
// list row and the detail page), then driven through a real resolve -> later-release regression so
// the "Regressed" indicator (issue #128) is also checked on the list row, not just the detail view.
test("environment, user, and contexts surface on the issue list/detail, and a regressed issue is flagged in the list", async ({ browser, request, baseURL }) => {
  await ensureContractTestActor();
  const dsnKey = await getDsnKey();
  const token = await mintTestSession({ ...CONTRACT_TEST_ACTOR, role: "member" });
  const cookie = `fd_session=${token}`;

  const tokenRes = await request.post("/api/internal/v1/projects/1/api-tokens", {
    headers: { Cookie: cookie },
  });
  const { token: apiToken } = await tokenRes.json() as { id: string; token: string };

  const uniqueTitle = `e2e-surface-${crypto.randomUUID().slice(0, 8)}`;
  const releaseA = `e2e-surface-a-${crypto.randomUUID().slice(0, 8)}`;
  const releaseB = `e2e-surface-b-${crypto.randomUUID().slice(0, 8)}`;

  await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    data: { version: releaseA, projects: ["1"] },
  });

  const stackFrame = { filename: "checkout.js", function: "submitOrder", in_app: true };

  const firstEventId = crypto.randomUUID();
  const firstIngest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildEnvelope(firstEventId, {
      level: "error",
      release: releaseA,
      environment: "production",
      user: { id: "qa-user-42", email: "qa-user-42@example.com" },
      contexts: {
        device: { model: "MacBook Pro", arch: "arm64" },
        app: { version: "3.2.1", build: "1042" },
      },
      exception: {
        values: [{ type: uniqueTitle, value: "seeded", stacktrace: { frames: [stackFrame] } }],
      },
    }),
  });
  expect(firstIngest.status()).toBe(200);

  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  // List row: environment tag visible, plus the (auto-appearing) environment filter pill.
  await page.getByText("Issues", { exact: true }).click();
  const issueRow = page.getByText(new RegExp(`^${uniqueTitle}:`));
  await expect(issueRow).toBeVisible();
  const issueRowContainer = page.locator('[role="button"]').filter({ hasText: uniqueTitle });
  await expect(issueRowContainer.getByText("production", { exact: true })).toBeVisible();
  await expect(page.getByText("All environments", { exact: true })).toBeVisible();

  // Detail page: environment tag, User section, Contexts section.
  await issueRow.click();
  await expect(page.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) })).toBeVisible();
  await expect(page.getByText("production", { exact: true })).toBeVisible();

  await expect(page.getByText("User", { exact: true })).toBeVisible();
  await expect(page.getByText("qa-user-42@example.com")).toBeVisible();

  // The group label is rendered with a CSS uppercase text-transform, but the underlying text
  // content (what Playwright matches) is still the raw lowercase context key.
  await expect(page.getByText("Contexts", { exact: true })).toBeVisible();
  await expect(page.getByText("device", { exact: true })).toBeVisible();
  await expect(page.getByText("MacBook Pro")).toBeVisible();
  await expect(page.getByText("app", { exact: true })).toBeVisible();
  await expect(page.getByText("3.2.1")).toBeVisible();

  // Resolve against release A, then ingest a second occurrence on a later release B — the
  // existing regression-detection flow (worker/modules/ingest/routes.ts, extended by #128's own
  // reopen logic) flips the issue back to unresolved with resolved_release_id still set, i.e.
  // "regressed".
  await page.getByText("Resolve", { exact: true }).click();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();

  await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    data: { version: releaseB, projects: ["1"] },
  });

  const secondEventId = crypto.randomUUID();
  const secondIngest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildEnvelope(secondEventId, {
      level: "error",
      release: releaseB,
      environment: "staging",
      exception: {
        values: [{ type: uniqueTitle, value: "seeded", stacktrace: { frames: [stackFrame] } }],
      },
    }),
  });
  expect(secondIngest.status()).toBe(200);

  // Back on the list, the regressed issue shows the "Regressed" tag and the latest event's
  // (updated) environment.
  await page.getByText("Issues", { exact: true }).click();
  await expect(issueRowContainer.getByText("Regressed", { exact: true })).toBeVisible();
  await expect(issueRowContainer.getByText("staging", { exact: true })).toBeVisible();

  await issueRow.click();
  await expect(page.getByText("Regressed", { exact: true })).toBeVisible();
  await expect(page.getByText("staging", { exact: true })).toBeVisible();

  await context.close();
});
