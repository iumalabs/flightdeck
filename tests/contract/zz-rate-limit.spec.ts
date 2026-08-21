import { expect, test } from "@playwright/test";
import { getDsnKey } from "./support/dsn-key.ts";

// Isolated from ingest-envelope.spec.ts (see the comment there): this test deliberately exhausts
// the demo DSN key's fixed 60s rate-limit window, which would make any sibling test that runs
// after it flake on a spurious 429. The "zz" prefix keeps it sorting last among this directory's
// spec files so it always runs after everything else that shares the key.

const DEMO_PROJECT_ID = "demo";

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
