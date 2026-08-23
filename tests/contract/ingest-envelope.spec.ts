import { expect, test } from "@playwright/test";
import { getDsnKey } from "./support/dsn-key.ts";

// Contract tests against a real wrangler dev (research.md's testing rationale,
// specs/002-error-monitoring) — hand-crafted envelope bodies matching contracts/ingest-api.md's
// grammar exactly, rather than requiring a full SDK install in the test harness. The demo
// project's DSN key is read from the local D1 database at test setup time rather than hardcoded,
// so this doesn't silently drift from whatever the baseline migration actually seeds.

const DEMO_PROJECT_ID = "demo";

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

// The rate-limit-exhausting test lives in zz-rate-limit.spec.ts, not here — it consumes this same
// DSN key's fixed 60s window, which would make any test that runs after it (in this file or
// source-map-upload.spec.ts) flake on a spurious 429. Isolating it to a file that sorts last
// keeps it from poisoning its siblings' rate-limit budget.
