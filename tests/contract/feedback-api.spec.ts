import { expect, test } from "@playwright/test";
import { mintTestSession } from "../e2e/support/session.ts";
import { getDsnKey } from "./support/dsn-key.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "./support/seed-actor.ts";

// Contract tests against a real wrangler dev (specs/007-user-feedback quickstart.md) — both ingest
// surfaces: the envelope-based widget path (extends Module 2's existing endpoint) and the
// crash-report dialog's GET/POST pair (contracts/feedback-ingest-api.md's confirmed real wire
// shape, research.md §1).

const DEMO_PROJECT_ID = "demo";

test.beforeAll(async () => {
  await ensureContractTestActor();
});

async function sessionCookie(): Promise<string> {
  const token = await mintTestSession({ ...CONTRACT_TEST_ACTOR, role: "member" });
  return `fd_session=${token}`;
}

function buildFeedbackEnvelope(
  eventId: string,
  feedback: Record<string, unknown>,
): string {
  // event_id belongs on the ITEM's own payload (mirroring buildErrorEnvelope below and
  // contracts/feedback-ingest-api.md's dedup note) — the envelope header's event_id is a separate,
  // envelope-level field, not what dedup reads.
  const payloadJson = JSON.stringify({ event_id: eventId, contexts: { feedback } });
  const payloadBytes = new TextEncoder().encode(payloadJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "feedback", length: payloadBytes });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

function buildErrorEnvelope(eventId: string, uniqueTitle: string): string {
  const payload = {
    event_id: eventId,
    level: "error",
    exception: {
      values: [{
        type: uniqueTitle,
        value: "seeded for feedback-api.spec.ts",
        stacktrace: { frames: [{ filename: "app.js", function: "handleClick", in_app: true }] },
      }],
    },
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "event", length: payloadBytes });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

// === Widget path (envelope) ===

test("a feedback envelope item with a valid DSN is recorded and appears in the feedback list", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const eventId = crypto.randomUUID();
  const uniqueMessage = `contract-widget-feedback-${eventId.slice(0, 8)}`;
  const body = buildFeedbackEnvelope(eventId, { message: uniqueMessage });

  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(ingest.status()).toBe(200);

  const list = await request.get("/api/internal/feedback", {
    headers: { Cookie: await sessionCookie() },
  });
  const { feedback } = await list.json() as {
    feedback: { message: string; issueId: string | null }[];
  };
  const found = feedback.find((f) => f.message === uniqueMessage);
  expect(found).toBeTruthy();
  expect(found?.issueId).toBeNull(); // standalone, no associated_event_id (Acceptance Scenario 3)
});

test("a feedback envelope item with an unknown DSN key is rejected, nothing recorded", async ({ request }) => {
  const eventId = crypto.randomUUID();
  const uniqueMessage = `contract-rejected-feedback-${eventId.slice(0, 8)}`;
  const body = buildFeedbackEnvelope(eventId, { message: uniqueMessage });

  const response = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=not-a-real-key&sentry_version=7`,
    { data: body },
  );
  expect(response.status()).toBe(403);

  const list = await request.get("/api/internal/feedback", {
    headers: { Cookie: await sessionCookie() },
  });
  const { feedback } = await list.json() as { feedback: { message: string }[] };
  expect(feedback.some((f) => f.message === uniqueMessage)).toBe(false);
});

test("a feedback item missing the required message field is dropped, not fatal to the envelope", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const eventId = crypto.randomUUID();
  const body = buildFeedbackEnvelope(eventId, { name: "no message here" });

  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(ingest.status()).toBe(200); // accepted-and-dropped, not a request-level failure
});

test("a repeated feedback submission (same item event_id) is not recorded twice", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const eventId = crypto.randomUUID();
  const uniqueMessage = `contract-dedup-feedback-${eventId.slice(0, 8)}`;
  const body = buildFeedbackEnvelope(eventId, { message: uniqueMessage });
  const url = `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`;

  await request.post(url, { data: body });
  await request.post(url, { data: body });

  const list = await request.get("/api/internal/feedback", {
    headers: { Cookie: await sessionCookie() },
  });
  const { feedback } = await list.json() as { feedback: { message: string }[] };
  const matches = feedback.filter((f) => f.message === uniqueMessage);
  expect(matches.length).toBe(1);
});

// === Crash-report dialog path ===

test("dialog GET with a valid dsn+eventId returns a text/javascript script", async ({ request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const errorEventId = crypto.randomUUID();
  const uniqueTitle = `contract-dialog-error-${errorEventId.slice(0, 8)}`;
  await request.post(`/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildErrorEnvelope(errorEventId, uniqueTitle),
  });

  const dsn = `https://${dsnKey}@${new URL(baseURL!).host}/${DEMO_PROJECT_ID}`;
  const res = await request.get(
    `/api/embed/error-page?dsn=${encodeURIComponent(dsn)}&eventId=${errorEventId}`,
  );
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/javascript");
  const body = await res.text();
  expect(body).toContain("__sentry_reportdialog_closed__");
});

test("dialog GET with a malformed/unresolvable dsn returns 404", async ({ request }) => {
  const res = await request.get(
    `/api/embed/error-page?dsn=${encodeURIComponent("https://not-a-real-key@host/demo")}&eventId=x`,
  );
  expect(res.status()).toBe(404);
});

test("dialog GET with no eventId returns 400", async ({ request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const dsn = `https://${dsnKey}@${new URL(baseURL!).host}/${DEMO_PROJECT_ID}`;
  const res = await request.get(`/api/embed/error-page?dsn=${encodeURIComponent(dsn)}`);
  expect(res.status()).toBe(400);
});

test("dialog POST records feedback linked to the referenced event's issue; a repeated POST upserts, not duplicates", async ({ request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const errorEventId = crypto.randomUUID();
  const uniqueTitle = `contract-dialog-linked-${errorEventId.slice(0, 8)}`;
  await request.post(`/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildErrorEnvelope(errorEventId, uniqueTitle),
  });

  const dsn = `https://${dsnKey}@${new URL(baseURL!).host}/${DEMO_PROJECT_ID}`;
  const submitUrl = `/api/embed/error-page?dsn=${encodeURIComponent(dsn)}&eventId=${errorEventId}`;

  // Both submissions embed uniqueTitle so the later list-scan below can't accidentally match a
  // leftover row from a PRIOR run of this same test against the persistent local D1 (found live —
  // reusing a fixed literal comment string across repeated runs accumulated matching rows from
  // earlier runs, making the assertion flaky/wrong for reasons that had nothing to do with the
  // upsert logic itself, which a direct manual reproduction confirmed was already correct).
  const first = await request.post(submitUrl, {
    form: {
      name: "Jane",
      email: "jane@example.com",
      comments: `${uniqueTitle}: it crashed after I clicked Save`,
    },
  });
  expect(first.status()).toBe(200);

  const second = await request.post(submitUrl, {
    form: {
      name: "Jane",
      email: "jane@example.com",
      comments: `${uniqueTitle}: updated, it crashed on Save`,
    },
  });
  expect(second.status()).toBe(200);

  const list = await request.get("/api/internal/feedback", {
    headers: { Cookie: await sessionCookie() },
  });
  const { feedback } = await list.json() as {
    feedback: { message: string; issueId: string | null }[];
  };
  const matches = feedback.filter((f) => f.message.startsWith(uniqueTitle));
  expect(matches.length).toBe(1); // upserted, not two rows
  expect(matches[0].message).toContain("updated"); // the SECOND submission's content survived
  expect(matches[0].issueId).not.toBeNull(); // linked to the referenced event's issue
});

test("dialog POST with no comments field returns 400", async ({ request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const dsn = `https://${dsnKey}@${new URL(baseURL!).host}/${DEMO_PROJECT_ID}`;
  const res = await request.post(
    `/api/embed/error-page?dsn=${encodeURIComponent(dsn)}&eventId=${crypto.randomUUID()}`,
    { form: { name: "Jane", email: "jane@example.com" } },
  );
  expect(res.status()).toBe(400);
});
