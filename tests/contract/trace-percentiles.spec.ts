import { expect, test } from "@playwright/test";
import { getDsnKey } from "./support/dsn-key.ts";
import { mintTestSession } from "../e2e/support/session.ts";

// T039 (Phase 7 Convergence, specs/003-distributed-tracing/tasks.md) — SC-004 and User Story 2's
// own Independent Test require verifying p50/p95 against a KNOWN duration distribution, not just
// unit-testing the pure computeOffset() arithmetic (tests/unit/percentiles.test.ts). This ingests
// 10 real transactions sharing one operation name via the actual envelope -> queue -> consumer ->
// D1 path, then asserts GET /api/internal/v1/traces's p50Ms/p95Ms for that operation match the
// hand-computed expected values, exercising percentileSql()/operationsListSql()/fetchPercentile()
// (worker/modules/ingest/percentiles.ts) against real seeded D1 data.

// migration 0009: the demo project seeded by that migration is deterministically id 1.
const DEMO_PROJECT_ID = "1";

// 10 known durations (ms), strictly increasing so the p50/p95 offsets are unambiguous.
// count=10: p50 offset = trunc(10*0.50)-1 = 4 -> sorted[4] = 500
//           p95 offset = trunc(10*0.95)-1 = 8 -> sorted[8] = 900
const KNOWN_DURATIONS_MS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
const EXPECTED_P50_MS = 500;
const EXPECTED_P95_MS = 900;

function buildTimedTransactionEnvelope(
  eventId: string,
  traceId: string,
  rootSpanId: string,
  name: string,
  durationMs: number,
): string {
  // Safely inside the 24h percentile window (research.md §7), and far enough in the past that all
  // 10 transactions' start_timestamps are comfortably ordered before "now".
  const startTimestamp = Date.now() / 1000 - 120;
  const timestamp = startTimestamp + durationMs / 1000;
  const payload = {
    event_id: eventId,
    type: "transaction",
    start_timestamp: startTimestamp,
    timestamp,
    transaction_info: { source: "route", transaction: name },
    contexts: {
      trace: { trace_id: traceId, span_id: rootSpanId, parent_span_id: null, op: "http.server" },
    },
    spans: [],
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "transaction", length: payloadBytes });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

let cachedCookie: string | null = null;
async function sessionCookieHeader(): Promise<string> {
  if (!cachedCookie) {
    const token = await mintTestSession({
      sub: "contract-trace-percentiles",
      email: "contract-trace-percentiles@example.com",
      role: "member",
    });
    cachedCookie = `fd_session=${token}`;
  }
  return cachedCookie;
}

interface OperationSummary {
  name: string;
  op: string | null;
  p50Ms: number;
  p95Ms: number;
  count: number;
  latestTransactionId: string;
}

// Bounded poll (research.md §9's async-delivery note) — waits for all 10 queued transactions to be
// consumed and written before asserting on the aggregate, rather than asserting immediately.
async function pollForOperationCount(
  request: import("@playwright/test").APIRequestContext,
  operationName: string,
  expectedCount: number,
  attempts = 20,
): Promise<OperationSummary | null> {
  for (let i = 0; i < attempts; i++) {
    const res = await request.get(`/api/internal/v1/traces?project=${DEMO_PROJECT_ID}`, {
      headers: { Cookie: await sessionCookieHeader() },
    });
    if (res.ok()) {
      const body = await res.json() as { operations: OperationSummary[] };
      const found = body.operations.find((op) => op.name === operationName);
      if (found && found.count >= expectedCount) return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

test("p50/p95 for a known duration distribution match hand-computed values", async ({ request }) => {
  const dsnKey = await getDsnKey();
  // Unique per test run so concurrently-running suites (or repeated local runs) never pollute this
  // operation's own aggregate — operationsListSql()/percentileSql() group strictly by name.
  const operationName = `GET /percentile-test-${crypto.randomUUID()}`;

  for (const durationMs of KNOWN_DURATIONS_MS) {
    const eventId = crypto.randomUUID();
    const traceId = crypto.randomUUID().replace(/-/g, "");
    const rootSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const body = buildTimedTransactionEnvelope(
      eventId,
      traceId,
      rootSpanId,
      operationName,
      durationMs,
    );
    const ingest = await request.post(
      `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
      { data: body },
    );
    expect(ingest.status()).toBe(200);
  }

  const summary = await pollForOperationCount(request, operationName, KNOWN_DURATIONS_MS.length);
  expect(summary).not.toBeNull();
  expect(summary!.count).toBe(KNOWN_DURATIONS_MS.length);
  expect(summary!.p50Ms).toBe(EXPECTED_P50_MS);
  expect(summary!.p95Ms).toBe(EXPECTED_P95_MS);
});
