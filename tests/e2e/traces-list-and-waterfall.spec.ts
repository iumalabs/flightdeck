import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { getDsnKey } from "../contract/support/dsn-key.ts";

// spec.md User Story 1 (transactions + waterfall) and User Story 3 (trace<->error cross-linking),
// end to end through the actual UI: seeds one real transaction and one real error sharing a
// trace_id via the public envelope endpoint, waits out the queue consumer's async delivery
// (research.md §9 — bounded, not unbounded), then drives Traces -> waterfall -> linked error ->
// issue detail -> "View trace" -> back to the same waterfall through a real browser,
// pre-authenticated (Module 1's pattern).

function buildTransactionEnvelope(
  eventId: string,
  traceId: string,
  rootSpanId: string,
  childSpanId: string,
  name: string,
  durationSeconds = 0.5,
): string {
  const startTimestamp = Date.now() / 1000 - 5;
  const payload = {
    event_id: eventId,
    type: "transaction",
    start_timestamp: startTimestamp,
    timestamp: startTimestamp + durationSeconds,
    transaction_info: { source: "route", transaction: name },
    contexts: {
      trace: { trace_id: traceId, span_id: rootSpanId, parent_span_id: null, op: "http.server" },
    },
    spans: [{
      span_id: childSpanId,
      parent_span_id: rootSpanId,
      op: "db.query",
      description: "SELECT * FROM carts WHERE id = ?",
      start_timestamp: startTimestamp + 0.1,
      timestamp: startTimestamp + 0.3,
      status: "ok",
    }],
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "transaction", length: payloadBytes });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

function buildErrorEnvelope(
  eventId: string,
  traceId: string,
  spanId: string,
  uniqueTitle: string,
): string {
  const payload = {
    event_id: eventId,
    level: "error",
    contexts: { trace: { trace_id: traceId, span_id: spanId } },
    exception: {
      values: [{
        type: uniqueTitle,
        value: "seeded for traces-list-and-waterfall.spec.ts",
        stacktrace: {
          frames: [{ filename: "checkout.js", function: "submitOrder", in_app: true }],
        },
      }],
    },
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "event", length: payloadBytes });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

test("traces list -> waterfall -> linked error -> issue detail -> back to trace", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const rootSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const childSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const uniqueOpName = `e2e-checkout-${traceId.slice(0, 8)}`;
  const uniqueTitle = `e2e-trace-error-${traceId.slice(0, 8)}`;

  const transactionEnvelope = buildTransactionEnvelope(
    crypto.randomUUID(),
    traceId,
    rootSpanId,
    childSpanId,
    uniqueOpName,
  );
  const txnIngest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: transactionEnvelope,
  });
  expect(txnIngest.status()).toBe(200);

  const errorEnvelope = buildErrorEnvelope(crypto.randomUUID(), traceId, rootSpanId, uniqueTitle);
  const errIngest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: errorEnvelope,
  });
  expect(errIngest.status()).toBe(200);

  // Bounded wait for the queue consumer's async write (research.md §9) — comfortably past
  // max_batch_timeout (5s, wrangler.jsonc), not an unbounded poll.
  await new Promise((resolve) => setTimeout(resolve, 7000));

  const token = await mintTestSession({
    sub: "e2e-traces-nav",
    email: "traces-nav@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await page.getByText("Traces", { exact: true }).click();
  const operationRow = page.getByText(uniqueOpName);
  await expect(operationRow).toBeVisible();
  await operationRow.click();

  await expect(page.getByRole("heading", { name: uniqueOpName })).toBeVisible();
  await expect(page.getByText("SELECT * FROM carts WHERE id = ?")).toBeVisible();

  await expect(page.getByText("Errors during this trace")).toBeVisible();
  const linkedErrorRow = page.getByText(new RegExp(`^${uniqueTitle}:`));
  await expect(linkedErrorRow).toBeVisible();
  await linkedErrorRow.click();

  await expect(page.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) })).toBeVisible();
  const viewTraceLink = page.getByText("View trace →");
  await expect(viewTraceLink).toBeVisible();
  await viewTraceLink.click();

  await expect(page.getByRole("heading", { name: uniqueOpName })).toBeVisible();

  await context.close();
});

// spec.md User Story 2 Acceptance Scenario 3 ("When a developer sorts or filters by duration,
// Then the slowest operations are easy to identify without manually comparing every row") and
// T041 (specs/003-distributed-tracing/tasks.md) — seeds three operations with distinct names,
// durations, and transaction counts so each of the four sortable fields (Operation, p50, p95,
// Count) produces a different row order, then drives the sort chips and asserts the list actually
// reorders, in both directions.
test("traces list sort controls reorder operations by each field and direction", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  // Every transaction within one operation shares the same duration, so p50 === p95 === that
  // duration regardless of count — keeping the expected ordering simple and unambiguous.
  const ops = [
    { suffix: "alpha", durationSeconds: 0.1, count: 1 },
    { suffix: "beta", durationSeconds: 0.3, count: 2 },
    { suffix: "gamma", durationSeconds: 0.2, count: 3 },
  ] as const;

  for (const op of ops) {
    const name = `e2e-sort-${runId}-${op.suffix}`;
    for (let i = 0; i < op.count; i++) {
      const traceId = crypto.randomUUID().replace(/-/g, "");
      const rootSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const childSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const envelope = buildTransactionEnvelope(
        crypto.randomUUID(),
        traceId,
        rootSpanId,
        childSpanId,
        name,
        op.durationSeconds,
      );
      const res = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
        data: envelope,
      });
      expect(res.status()).toBe(200);
    }
  }

  // Bounded wait for the queue consumer's async write (research.md §9), same rationale as above.
  await new Promise((resolve) => setTimeout(resolve, 7000));

  const token = await mintTestSession({
    sub: "e2e-traces-sort",
    email: "traces-sort@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByText("Traces", { exact: true }).click();

  const names = {
    alpha: `e2e-sort-${runId}-alpha`,
    beta: `e2e-sort-${runId}-beta`,
    gamma: `e2e-sort-${runId}-gamma`,
  };
  await expect(page.getByText(names.beta, { exact: true })).toBeVisible();

  const rowNameSelector = [names.alpha, names.beta, names.gamma]
    .map((n) => `div:text-is("${n}")`)
    .join(", ");
  const visibleOrder = () => page.locator(rowNameSelector).allTextContents();

  // Default state: unchanged fixed p95-descending behavior (beta 300ms, gamma 200ms, alpha 100ms).
  await expect.poll(visibleOrder).toEqual([names.beta, names.gamma, names.alpha]);

  // Operation name, ascending (the field's default direction) then descending on a second click.
  await page.getByRole("button", { name: /^Operation/ }).click();
  await expect.poll(visibleOrder).toEqual([names.alpha, names.beta, names.gamma]);
  await page.getByRole("button", { name: /^Operation/ }).click();
  await expect.poll(visibleOrder).toEqual([names.gamma, names.beta, names.alpha]);

  // Count: descending (gamma=3, beta=2, alpha=1) by default, ascending on a second click.
  await page.getByRole("button", { name: /^Count/ }).click();
  await expect.poll(visibleOrder).toEqual([names.gamma, names.beta, names.alpha]);
  await page.getByRole("button", { name: /^Count/ }).click();
  await expect.poll(visibleOrder).toEqual([names.alpha, names.beta, names.gamma]);

  // p50: switching field re-sorts back to duration order (descending default).
  await page.getByRole("button", { name: /^p50/ }).click();
  await expect.poll(visibleOrder).toEqual([names.beta, names.gamma, names.alpha]);

  await context.close();
});
