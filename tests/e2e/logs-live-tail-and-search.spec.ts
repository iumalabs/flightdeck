import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { getDsnKey } from "../contract/support/dsn-key.ts";

// spec.md User Story 1 (live tail) and User Story 2 (search), end to end through the actual UI —
// Playwright's native WebSocket support (research.md §10, specs/004-structured-logs:
// page.waitForEvent('websocket')) rather than a separate raw-WebSocket test client.

function buildLogEnvelope(eventId: string, records: Record<string, unknown>[]): string {
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

test("live tail shows a log line within moments of it being emitted", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const token = await mintTestSession({
    sub: "e2e-live-tail",
    email: "live-tail@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  // Registered BEFORE the click that triggers LogsScreen to mount and open its WebSocket — the
  // connection can open synchronously within the same tick as the click, so listening only after
  // the click risks missing the event entirely (confirmed live: this exact ordering timed out).
  const wsPromise = page.waitForEvent("websocket", (ws) => ws.url().includes("/live-tail"));
  await page.getByText("Logs", { exact: true }).click();
  await expect(page.getByText("Live tail")).toBeVisible();
  const ws = await wsPromise;

  const uniqueBody = `live-tail-line-${crypto.randomUUID().slice(0, 8)}`;
  const framePromise = ws.waitForEvent("framereceived", {
    predicate: (frame) => {
      const text = typeof frame.payload === "string" ? frame.payload : "";
      return text.includes(uniqueBody);
    },
    timeout: 15_000,
  });

  const body = buildLogEnvelope(crypto.randomUUID(), [
    { timestamp: Date.now() / 1000, level: "info", body: uniqueBody },
  ]);
  const ingest = await request.post(`/api/demo/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: body,
  });
  expect(ingest.status()).toBe(200);

  await framePromise;
  await expect(page.getByText(uniqueBody)).toBeVisible();

  await context.close();
});

test("search finds ingested log lines by text and level, and cross-links to a trace", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const rootSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const uniqueWord = `searchable-${crypto.randomUUID().slice(0, 8)}`;
  const opName = `e2e-logs-trace-${traceId.slice(0, 8)}`;

  const logBody = buildLogEnvelope(crypto.randomUUID(), [
    { timestamp: Date.now() / 1000, trace_id: traceId, level: "info", body: uniqueWord },
  ]);
  const logIngest = await request.post(`/api/demo/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: logBody,
  });
  expect(logIngest.status()).toBe(200);

  const startTimestamp = Date.now() / 1000 - 5;
  const txnPayload = JSON.stringify({
    event_id: crypto.randomUUID(),
    type: "transaction",
    start_timestamp: startTimestamp,
    timestamp: startTimestamp + 0.5,
    transaction_info: { transaction: opName },
    contexts: { trace: { trace_id: traceId, span_id: rootSpanId, op: "http.server" } },
    spans: [],
  });
  const txnBytes = new TextEncoder().encode(txnPayload).length;
  const txnEnvelope = [
    JSON.stringify({ event_id: crypto.randomUUID() }),
    JSON.stringify({ type: "transaction", length: txnBytes }),
    txnPayload,
  ].join("\n");
  const txnIngest = await request.post(`/api/demo/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: txnEnvelope,
  });
  expect(txnIngest.status()).toBe(200);

  // Bounded wait for both queue consumers' async writes (research.md §9/§10).
  await new Promise((resolve) => setTimeout(resolve, 7000));

  const token = await mintTestSession({
    sub: "e2e-logs-search",
    email: "logs-search@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await page.getByText("Logs", { exact: true }).click();
  await page.getByText("Search", { exact: true }).click();
  await page.getByPlaceholder("Search log content…").fill(uniqueWord);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(uniqueWord)).toBeVisible();

  await page.getByText("trace →").click();
  await expect(page.getByRole("heading", { name: opName })).toBeVisible();
  await expect(page.getByText("Logs during this trace")).toBeVisible();
  await expect(page.getByText(uniqueWord)).toBeVisible();

  await context.close();
});
