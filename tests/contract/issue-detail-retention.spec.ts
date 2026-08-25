import { expect, test } from "@playwright/test";
import { getDsnKey } from "./support/dsn-key.ts";
import { mintTestSession } from "../e2e/support/session.ts";

// T050 (specs/002-error-monitoring Phase 8 Convergence) — GET /api/internal/issues/{id} must
// distinguish "no stack trace/breadcrumbs were ever recorded" (an events row exists, its payload
// just never carried that data) from "this issue's only occurrence(s) aged out under retention"
// (no events row is left at all, even though the issue's own event_count proves one WAS ingested)
// via the new `eventDataRetained` field (contracts/internal-api.md). Simulates retention having
// pruned an issue's only event by deleting its `events` row directly against the local preview D1
// — the same out-of-band-D1-manipulation technique tests/contract/support/seed-actor.ts already
// uses — rather than waiting on/re-exercising the actual retention cron job, which is already
// covered by tests/unit/retention.test.ts.

// migration 0009: the demo project seeded by that migration is deterministically id 1.
const DEMO_PROJECT_ID = "1";

function buildErrorEnvelope(eventId: string, uniqueTitle: string): string {
  const payload = {
    event_id: eventId,
    level: "error",
    exception: {
      values: [{
        type: uniqueTitle,
        value: "seeded for issue-detail-retention.spec.ts",
        stacktrace: { frames: [{ filename: "app.js", function: "handleClick", in_app: true }] },
      }],
    },
    breadcrumbs: [{ category: "nav", message: "clicked checkout" }],
  };
  const payloadJson = JSON.stringify(payload);
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({
    type: "event",
    length: new TextEncoder().encode(payloadJson).length,
  });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

async function sessionCookieHeader(): Promise<string> {
  const token = await mintTestSession({
    sub: "contract-issue-retention",
    email: "contract-issue-retention@example.com",
    role: "member",
  });
  return `fd_session=${token}`;
}

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
    const res = await request.get(`/api/internal/v1/issues?project=${DEMO_PROJECT_ID}&status=all`, {
      headers: { Cookie: cookie },
    });
    const { issues } = await res.json() as { issues: { id: string; title: string }[] };
    const found = issues.find((iss) => iss.title.includes(title));
    if (found) return found.id;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`issue with title containing "${title}" never appeared`);
}

test("an issue whose only event still exists reports eventDataRetained true, with real stack trace/breadcrumbs", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const title = `retention-present-${crypto.randomUUID().slice(0, 8)}`;
  const eventId = crypto.randomUUID();
  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: buildErrorEnvelope(eventId, title) },
  );
  expect(ingest.status()).toBe(200);

  const cookie = await sessionCookieHeader();
  const issueId = await findIssueIdByTitle(request, cookie, title);

  const detail = await request.get(`/api/internal/v1/issues/${issueId}`, {
    headers: { Cookie: cookie },
  });
  expect(detail.status()).toBe(200);
  const body = await detail.json() as {
    eventDataRetained: boolean;
    latestEvent: { stacktrace: { frames: unknown[] } | null; breadcrumbs: unknown[] } | null;
  };
  expect(body.eventDataRetained).toBe(true);
  expect(body.latestEvent?.stacktrace?.frames?.length).toBeGreaterThan(0);
  expect(body.latestEvent?.breadcrumbs.length).toBeGreaterThan(0);
});

test("an issue whose only event was pruned by retention reports eventDataRetained false, not identical-to-never-recorded", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const title = `retention-pruned-${crypto.randomUUID().slice(0, 8)}`;
  const eventId = crypto.randomUUID();
  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: buildErrorEnvelope(eventId, title) },
  );
  expect(ingest.status()).toBe(200);

  const cookie = await sessionCookieHeader();
  const issueId = await findIssueIdByTitle(request, cookie, title);

  // Simulate the retention job having pruned this issue's only event — the `issues` aggregate row
  // (and its event_count) is left untouched, matching pruneOldEvents' actual behavior
  // (worker/modules/ingest/retention.ts deletes from `events` only, never `issues`).
  await deleteEventsForIssue(issueId);

  const detail = await request.get(`/api/internal/v1/issues/${issueId}`, {
    headers: { Cookie: cookie },
  });
  expect(detail.status()).toBe(200);
  const body = await detail.json() as {
    eventCount: number;
    eventDataRetained: boolean;
    latestEvent: unknown;
  };
  expect(body.eventCount).toBeGreaterThan(0); // proves an event WAS ingested at some point
  expect(body.latestEvent).toBeNull();
  expect(body.eventDataRetained).toBe(false); // distinguishes this from "never recorded"
});
