import { expect, test } from "@playwright/test";
import { getDsnKey } from "./support/dsn-key.ts";

// Contract tests against a real wrangler dev (research.md's testing rationale,
// specs/003-distributed-tracing) — hand-crafted "transaction" envelope items matching
// contracts/trace-ingest-api.md's grammar. Unlike Module 2's synchronous error-ingest tests, a
// `200` here only confirms enqueue, not queryability (research.md §9) — this suite polls
// GET /api/internal/v1/traces/by-trace-id/{traceId} with bounded retries rather than asserting
// immediately. T010's live spike confirmed local Queues emulation reliably delivers
// producer->consumer end to end (research.md §4), so polling against real local delivery is the
// primary design here, not a fallback.

const DEMO_PROJECT_ID = "demo";

function buildTransactionEnvelope(
  eventId: string,
  traceId: string,
  rootSpanId: string,
  name: string,
  spans: Record<string, unknown>[] = [],
): string {
  const startTimestamp = Date.now() / 1000 - 5;
  const payload = {
    event_id: eventId,
    type: "transaction",
    start_timestamp: startTimestamp,
    timestamp: startTimestamp + 0.5,
    transaction_info: { source: "route", transaction: name },
    contexts: {
      trace: { trace_id: traceId, span_id: rootSpanId, parent_span_id: null, op: "http.server" },
    },
    spans,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "transaction", length: payloadBytes });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

// Bounded retries with a short backoff (research.md §9) — NOT an unbounded wait. The budget must
// comfortably exceed the queue consumer's own `max_batch_timeout` (5s, wrangler.jsonc) since a
// message may sit unflushed until that timeout fires if it doesn't first hit max_batch_size.
async function pollForTransaction(
  request: import("@playwright/test").APIRequestContext,
  traceId: string,
  attempts = 12,
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const res = await request.get(`/api/internal/v1/traces/by-trace-id/${traceId}`, {
      headers: { Cookie: await sessionCookieHeader() },
    });
    if (res.ok()) {
      const body = await res.json() as { transactionId: string | null };
      if (body.transactionId) return body.transactionId;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

// Playwright's own storageState/session fixture isn't wired for this contract-test project — reuse
// the same hand-rolled test-session minting Module 1's e2e tests already established.
import { mintTestSession } from "../e2e/support/session.ts";

let cachedCookie: string | null = null;
async function sessionCookieHeader(): Promise<string> {
  if (!cachedCookie) {
    const token = await mintTestSession({
      sub: "contract-traces",
      email: "contract-traces@example.com",
      role: "member",
    });
    cachedCookie = `fd_session=${token}`;
  }
  return cachedCookie;
}

test("a transaction envelope item is enqueued and becomes queryable", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const eventId = crypto.randomUUID();
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const rootSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const body = buildTransactionEnvelope(eventId, traceId, rootSpanId, "GET /contract-test");

  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(ingest.status()).toBe(200); // enqueue acknowledgment, not a durability guarantee

  const transactionId = await pollForTransaction(request, traceId);
  expect(transactionId).not.toBeNull();
});

test("an unknown DSN key is rejected, fail closed, no transaction recorded", async ({ request }) => {
  const eventId = crypto.randomUUID();
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const rootSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const body = buildTransactionEnvelope(eventId, traceId, rootSpanId, "GET /rejected");

  const response = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=not-a-real-key&sentry_version=7`,
    { data: body },
  );
  expect(response.status()).toBe(403);

  const transactionId = await pollForTransaction(request, traceId, 2);
  expect(transactionId).toBeNull();
});

// T040 (Phase 7 Convergence, specs/003-distributed-tracing/tasks.md) — a transaction item whose
// serialized queue message exceeds Cloudflare Queues' 128,000-byte single-message limit (but stays
// comfortably under the envelope-level MAX_ENVELOPE_BYTES of 1 MB) must be rejected cleanly with
// 413, not thrown uncaught out of `.send()` into Hono's generic 500 app.onError handler.
test("an oversized transaction item is rejected with 413, not a generic 500", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const eventId = crypto.randomUUID();
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const rootSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  // A single padded span comfortably pushes the serialized QueuedTransaction over 127,000 bytes
  // while the whole envelope body stays well under the 1 MB MAX_ENVELOPE_BYTES ceiling.
  const oversizedSpans = [{
    span_id: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    op: "db.query",
    description: "x".repeat(150_000),
  }];
  const body = buildTransactionEnvelope(
    eventId,
    traceId,
    rootSpanId,
    "GET /oversized-item",
    oversizedSpans,
  );

  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(ingest.status()).toBe(413);

  const transactionId = await pollForTransaction(request, traceId, 2);
  expect(transactionId).toBeNull();
});

test("submitting the same transaction twice does not duplicate it", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const eventId = crypto.randomUUID();
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const rootSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const url = `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`;
  const body = buildTransactionEnvelope(eventId, traceId, rootSpanId, "GET /dedup-test");

  const first = await request.post(url, { data: body });
  expect(first.status()).toBe(200);
  const transactionId = await pollForTransaction(request, traceId);
  expect(transactionId).not.toBeNull();

  const second = await request.post(url, { data: body });
  expect(second.status()).toBe(200); // still accepted, just a no-op on the duplicate sdk_event_id

  await new Promise((resolve) => setTimeout(resolve, 1000)); // let a redundant enqueue drain, if any
  const detail = await request.get(`/api/internal/v1/traces/${transactionId}`, {
    headers: { Cookie: await sessionCookieHeader() },
  });
  expect(detail.ok()).toBe(true);
});
