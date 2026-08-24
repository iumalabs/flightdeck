import { expect, test } from "@playwright/test";
import { getDsnKey } from "./support/dsn-key.ts";
import { mintTestSession } from "../e2e/support/session.ts";

// Contract tests against a real wrangler dev (Module 3's established async-queue-polling pattern,
// research.md §10, specs/004-structured-logs) — hand-crafted "log" envelope items matching
// contracts/log-ingest-api.md's grammar.

const DEMO_PROJECT_ID = "demo";

function buildLogEnvelope(
  eventId: string,
  records: Record<string, unknown>[],
): string {
  const payload = JSON.stringify({ items: records });
  const payloadBytes = new TextEncoder().encode(payload).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({
    type: "log",
    item_count: records.length,
    content_type: "application/vnd.sentry.items.log+json",
    length: payloadBytes,
  });
  return [envelopeHeader, itemHeader, payload].join("\n");
}

async function pollForLine(
  request: import("@playwright/test").APIRequestContext,
  cookie: string,
  q: string,
  attempts = 12,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const res = await request.get(`/api/internal/v1/logs/search?q=${encodeURIComponent(q)}`, {
      headers: { Cookie: cookie },
    });
    if (res.ok()) {
      const body = await res.json() as { lines: unknown[] };
      if (body.lines.length > 0) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

let cachedCookie: string | null = null;
async function sessionCookieHeader(): Promise<string> {
  if (!cachedCookie) {
    const token = await mintTestSession({
      sub: "contract-logs",
      email: "contract-logs@example.com",
      role: "member",
    });
    cachedCookie = `fd_session=${token}`;
  }
  return cachedCookie;
}

test("a log envelope item is enqueued and its content becomes searchable", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const uniqueWord = `contractword${crypto.randomUUID().slice(0, 8)}`;
  const body = buildLogEnvelope(crypto.randomUUID(), [
    { timestamp: Date.now() / 1000, level: "info", body: `event ${uniqueWord} occurred` },
  ]);

  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(ingest.status()).toBe(200);

  const cookie = await sessionCookieHeader();
  const found = await pollForLine(request, cookie, uniqueWord);
  expect(found).toBe(true);
});

test("a hyphenated search query does not 500 (FTS5 quoting regression)", async ({ request }) => {
  const cookie = await sessionCookieHeader();
  const res = await request.get(`/api/internal/v1/logs/search?q=zzz-nonexistent-zzz`, {
    headers: { Cookie: cookie },
  });
  expect(res.status()).toBe(200);
  const body = await res.json() as { lines: unknown[] };
  expect(body.lines).toEqual([]);
});

test("an unknown DSN key is rejected, fail closed, no log data recorded", async ({ request }) => {
  const uniqueWord = `rejectedword${crypto.randomUUID().slice(0, 8)}`;
  const body = buildLogEnvelope(crypto.randomUUID(), [
    { timestamp: Date.now() / 1000, level: "info", body: uniqueWord },
  ]);
  const response = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=not-a-real-key&sentry_version=7`,
    { data: body },
  );
  expect(response.status()).toBe(403);

  const cookie = await sessionCookieHeader();
  const found = await pollForLine(request, cookie, uniqueWord, 2);
  expect(found).toBe(false);
});

test("submitting the same envelope (same envelope header event_id) twice does not duplicate search results", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const marker = crypto.randomUUID().slice(0, 8);
  const eventId = crypto.randomUUID();
  const body = buildLogEnvelope(eventId, [
    { timestamp: Date.now() / 1000, level: "info", body: `dedup-${marker}-retried-line` },
  ]);
  const url = `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`;

  const first = await request.post(url, { data: body });
  expect(first.status()).toBe(200);

  const cookie = await sessionCookieHeader();
  const found = await pollForLine(request, cookie, `dedup-${marker}`);
  expect(found).toBe(true);

  // Retry the IDENTICAL envelope (same header event_id) — simulates a client retry or Cloudflare
  // Queues' at-least-once redelivery of the same submission (T044).
  const second = await request.post(url, { data: body });
  expect(second.status()).toBe(200); // still accepted, just a no-op on the duplicate submission

  await new Promise((resolve) => setTimeout(resolve, 1500)); // let a redundant enqueue drain, if any
  const res = await request.get(
    `/api/internal/v1/logs/search?q=${encodeURIComponent(`dedup-${marker}`)}`,
    { headers: { Cookie: cookie } },
  );
  const resultBody = await res.json() as { lines: { body: string }[] };
  expect(resultBody.lines.length).toBe(1); // not 2 — the retried submission was deduplicated
});

test("submitting a batch of 3 log lines records all 3, not just the first", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const marker = crypto.randomUUID().slice(0, 8);
  const now = Date.now() / 1000;
  const body = buildLogEnvelope(crypto.randomUUID(), [
    { timestamp: now, level: "info", body: `batch-${marker}-line-1` },
    { timestamp: now + 0.01, level: "info", body: `batch-${marker}-line-2` },
    { timestamp: now + 0.02, level: "info", body: `batch-${marker}-line-3` },
  ]);
  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(ingest.status()).toBe(200);

  const cookie = await sessionCookieHeader();
  const found = await pollForLine(request, cookie, `batch-${marker}`);
  expect(found).toBe(true);
  // Give the write a moment to have landed fully, then confirm all 3 lines are present.
  const res = await request.get(
    `/api/internal/v1/logs/search?q=${encodeURIComponent(`batch-${marker}`)}`,
    {
      headers: { Cookie: cookie },
    },
  );
  const resultBody = await res.json() as { lines: { body: string }[] };
  expect(resultBody.lines.length).toBe(3);
});
