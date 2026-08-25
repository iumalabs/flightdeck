import { expect, test } from "@playwright/test";
import { getDsnKey } from "./support/dsn-key.ts";

// Isolated from ingest-envelope.spec.ts (see the comment there): this test deliberately exhausts
// the demo DSN key's fixed 60s rate-limit window, which would make any sibling test that runs
// after it flake on a spurious 429. The "zz" prefix keeps it sorting last among this directory's
// spec files so it always runs after everything else that shares the key.

// migration 0009: the demo project seeded by that migration is deterministically id 1.
const DEMO_PROJECT_ID = "1";

function buildEnvelope(eventId: string, payload: Record<string, unknown>): string {
  const eventJson = JSON.stringify({ event_id: eventId, ...payload });
  const payloadBytes = new TextEncoder().encode(eventJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "event", length: payloadBytes });
  return [envelopeHeader, itemHeader, eventJson].join("\n");
}

test("exceeding the rate limit responds 429 with the X-Sentry-Rate-Limits header", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const url = `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`;

  let last;
  for (let i = 0; i < 110; i++) {
    last = await request.post(url, {
      data: buildEnvelope(crypto.randomUUID(), { message: `spam ${i}` }),
    });
    if (last.status() === 429) break;
  }

  expect(last?.status()).toBe(429);
  const header = last?.headers()["x-sentry-rate-limits"];
  expect(header).toMatch(/^\d+::key$/);
});

// The crash-report dialog's GET/POST handlers (specs/007-user-feedback tasks.md T028) share the
// EXACT SAME per-DSN-key RATE_LIMITER shard as the envelope path's default bucket above — keyed by
// the DSN's public key, which is the same string as the envelope path's `sentry_key`. Placed right
// after the exhausting test above (this file's "zz" sort position guarantees it runs last, and
// `fullyParallel: false` + `workers: 1` in playwright.contract.config.ts guarantees this ordering
// within the file too), so the demo key's window is already over budget here — a single request to
// each dialog handler is enough to observe the 429, no need to repeat the whole exhaustion loop.
test("dialog GET also 429s once the shared per-DSN-key budget is already exhausted", async ({ request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const dsn = `https://${dsnKey}@${new URL(baseURL!).host}/${DEMO_PROJECT_ID}`;
  const res = await request.get(
    `/api/embed/error-page?dsn=${encodeURIComponent(dsn)}&eventId=${crypto.randomUUID()}`,
  );
  expect(res.status()).toBe(429);
  expect(res.headers()["x-sentry-rate-limits"]).toMatch(/^\d+::key$/);
});

test("dialog POST also 429s once the shared per-DSN-key budget is already exhausted", async ({ request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const dsn = `https://${dsnKey}@${new URL(baseURL!).host}/${DEMO_PROJECT_ID}`;
  const res = await request.post(
    `/api/embed/error-page?dsn=${encodeURIComponent(dsn)}&eventId=${crypto.randomUUID()}`,
    { form: { name: "Jane", email: "jane@example.com", comments: "should be rate limited" } },
  );
  expect(res.status()).toBe(429);
  expect(res.headers()["x-sentry-rate-limits"]).toMatch(/^\d+::key$/);
});
