import { expect, test } from "@playwright/test";
import { getDsnKey } from "./support/dsn-key.ts";

// Contract tests against a real wrangler dev (research.md's testing rationale,
// specs/002-error-monitoring) — hand-crafted envelope bodies matching contracts/ingest-api.md's
// grammar exactly, rather than requiring a full SDK install in the test harness. The demo
// project's DSN key is read from the local D1 database at test setup time rather than hardcoded,
// so this doesn't silently drift from whatever the baseline migration actually seeds.

// migration 0009: `projects.id` is now D1/SQLite's native auto-assigning INTEGER PRIMARY KEY — the
// demo project seeded by that migration's INSERT is always the first (and, in a freshly-migrated
// local D1, only) row, so its id is deterministically 1.
const DEMO_PROJECT_ID = "1";

function buildEnvelope(eventId: string, payload: Record<string, unknown>): string {
  const eventJson = JSON.stringify({ event_id: eventId, ...payload });
  const payloadBytes = new TextEncoder().encode(eventJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "event", length: payloadBytes });
  return [envelopeHeader, itemHeader, eventJson].join("\n");
}

function jsShapedPayload(): Record<string, unknown> {
  return {
    platform: "javascript",
    level: "error",
    exception: {
      values: [{
        type: "TypeError",
        value: "Cannot read properties of undefined",
        stacktrace: {
          frames: [
            { filename: "vendor.min.js", function: "n", lineno: 1, colno: 42, in_app: false },
            { filename: "app.min.js", function: "useCheckout", lineno: 3, colno: 15, in_app: true },
          ],
        },
      }],
    },
  };
}

function pythonShapedPayload(): Record<string, unknown> {
  return {
    platform: "python",
    level: "error",
    exception: {
      values: [{
        type: "OperationalError",
        value: "too many connections",
        stacktrace: {
          frames: [
            {
              filename: "db/pool.py",
              function: "acquire",
              module: "db.pool",
              lineno: 42,
              in_app: true,
              vars: { retries: "3" },
            },
          ],
        },
      }],
    },
  };
}

test("a JS-shaped event is accepted and produces an issue", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const body = buildEnvelope(crypto.randomUUID(), jsShapedPayload());

  const response = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(response.status()).toBe(200);
});

test("a Python-shaped event (header-based auth) is accepted", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const body = buildEnvelope(crypto.randomUUID(), pythonShapedPayload());

  const response = await request.post(`/api/${DEMO_PROJECT_ID}/envelope`, {
    data: body,
    headers: {
      "X-Sentry-Auth":
        `Sentry sentry_version=7, sentry_client=sentry.python/1.0, sentry_key=${dsnKey}`,
    },
  });
  expect(response.status()).toBe(200);
});

test("a trailing-slash envelope path (the real @sentry/core SDK's actual wire shape) is accepted", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const body = buildEnvelope(crypto.randomUUID(), jsShapedPayload());

  const response = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope/?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(response.status()).toBe(200);
});

// migration 0009 / worker/modules/ingest/dsn-auth.ts's isNumericProjectId — a UUID-shaped (the
// project id format FlightDeck used to issue) or otherwise non-numeric project-id path segment is
// rejected the same way an unknown DSN key is, before it ever reaches a DB query, matching the
// real @sentry/core SDK's own /^\d+$/ DSN validation this migration exists to satisfy.
test("a non-numeric (e.g. UUID-shaped) project id is rejected with 403, fail closed", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const body = buildEnvelope(crypto.randomUUID(), jsShapedPayload());
  const response = await request.post(
    `/api/0d1f8b2a-1234-4abc-9def-1234567890ab/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(response.status()).toBe(403);
});

test("an unknown DSN key is rejected, fail closed", async ({ request }) => {
  const body = buildEnvelope(crypto.randomUUID(), jsShapedPayload());
  const response = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=not-a-real-key&sentry_version=7`,
    { data: body },
  );
  expect(response.status()).toBe(403);
});

test("submitting the same event twice does not duplicate it", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const eventId = crypto.randomUUID();
  const body = buildEnvelope(eventId, jsShapedPayload());
  const url = `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`;

  const first = await request.post(url, { data: body });
  expect(first.status()).toBe(200);
  const second = await request.post(url, { data: body });
  expect(second.status()).toBe(200); // still accepted, just a no-op — not an error
});

// T051 (specs/002-error-monitoring Phase 8 Convergence) — the whole-envelope-body size guard
// (`MAX_ENVELOPE_BYTES`, 1 MB, `worker/modules/ingest/routes.ts`) has no test coverage anywhere
// despite contracts/ingest-api.md naming it as part of the ingest contract (FR-013): the ONLY
// existing 413 test (trace-ingest.spec.ts's "an oversized transaction item") exercises a DIFFERENT,
// item-level guard (`MAX_QUEUE_MESSAGE_BYTES`, 127,000 bytes) whose whole envelope body stays well
// under this one — it never touches this check at all.
test("an envelope body over 1 MB is rejected with 413, not accepted or a generic 500", async ({ request }) => {
  const dsnKey = await getDsnKey();
  // Padded well past MAX_ENVELOPE_BYTES (1,000,000 bytes) via a single oversized string value —
  // the envelope is rejected on raw body length before any JSON parsing happens, so the payload
  // doesn't need to be a realistic/parseable event otherwise.
  const body = buildEnvelope(crypto.randomUUID(), {
    platform: "javascript",
    padding: "x".repeat(1_100_000),
  });

  const response = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(response.status()).toBe(413);
});

// The rate-limit-exhausting test lives in zz-rate-limit.spec.ts, not here — it consumes this same
// DSN key's fixed 60s window, which would make any test that runs after it (in this file or
// source-map-upload.spec.ts) flake on a spurious 429. Isolating it to a file that sorts last
// keeps it from poisoning its siblings' rate-limit budget.
