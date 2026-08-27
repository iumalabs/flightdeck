import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { getDsnKey } from "../contract/support/dsn-key.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "../contract/support/seed-actor.ts";

// Regression coverage for issue #109: selecting an item inside a list screen (issue, trace,
// release, uptime check, feedback item) used to open its detail view via pure in-memory React
// state — the URL never changed, so there was no bookmarking, no browser back/forward, and a
// reload mid-detail-view dropped the user back to the plain list with no way to recover which item
// they'd been looking at. AppShell.tsx now threads an id segment through the same
// parsePathname/navigate() routing issue #58 established for the top-level screens
// (/web-app/issues/{id}, /web-app/traces/{id}, /web-app/releases/{id}, /web-app/uptime/{id},
// /web-app/feedback/{id}), so this file exercises each of the five detail types.

function buildErrorEnvelope(eventId: string, uniqueTitle: string): string {
  const payload = JSON.stringify({
    event_id: eventId,
    level: "error",
    exception: {
      values: [{
        type: uniqueTitle,
        value: "seeded for detail-view-deep-linking.spec.ts",
        stacktrace: {
          frames: [{ filename: "checkout.js", function: "submitOrder", in_app: true }],
        },
      }],
    },
  });
  const bytes = new TextEncoder().encode(payload).length;
  return [
    JSON.stringify({ event_id: eventId }),
    JSON.stringify({ type: "event", length: bytes }),
    payload,
  ].join("\n");
}

function buildTransactionEnvelope(eventId: string, traceId: string, name: string): string {
  const startTimestamp = Date.now() / 1000 - 5;
  const payload = {
    event_id: eventId,
    type: "transaction",
    start_timestamp: startTimestamp,
    timestamp: startTimestamp + 0.5,
    transaction_info: { source: "route", transaction: name },
    contexts: {
      trace: {
        trace_id: traceId,
        span_id: crypto.randomUUID(),
        parent_span_id: null,
        op: "http.server",
      },
    },
    spans: [],
  };
  const payloadJson = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(payloadJson).length;
  return [
    JSON.stringify({ event_id: eventId }),
    JSON.stringify({ type: "transaction", length: bytes }),
    payloadJson,
  ].join("\n");
}

function buildFeedbackEnvelope(eventId: string, message: string): string {
  const payloadJson = JSON.stringify({
    event_id: eventId,
    contexts: { feedback: { message } },
  });
  const bytes = new TextEncoder().encode(payloadJson).length;
  return [
    JSON.stringify({ event_id: eventId }),
    JSON.stringify({ type: "feedback", length: bytes }),
    payloadJson,
  ].join("\n");
}

test("selecting an issue updates the URL, survives reload, and supports back/forward", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const uniqueTitle = `e2e-deeplink-issue-${crypto.randomUUID().slice(0, 8)}`;
  const ingest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildErrorEnvelope(crypto.randomUUID(), uniqueTitle),
  });
  expect(ingest.status()).toBe(200);

  const token = await mintTestSession({
    sub: "e2e-deeplink-issues",
    email: "deeplink-issues@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await page.getByText("Issues", { exact: true }).click();
  await expect(page).toHaveURL(/\/web-app\/issues$/);
  const issueRow = page.getByText(new RegExp(`^${uniqueTitle}:`));
  await expect(issueRow).toBeVisible();
  await issueRow.click();

  await expect(page).toHaveURL(/\/web-app\/issues\/[^/]+$/);
  const detailUrl = page.url();
  await expect(page.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) })).toBeVisible();

  // Reload mid-detail-view must land back on the same detail, not the list.
  await page.reload();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) })).toBeVisible();

  // Browser back returns to the list; forward returns to the same detail.
  await page.goBack();
  await expect(page).toHaveURL(/\/web-app\/issues$/);
  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) })).toBeVisible();

  // A raw direct navigation to the constructed detail URL — no prior in-app navigation — must
  // fetch and show that issue directly, not fall back to the list (the exact support scenario
  // that prompted issue #109).
  const freshPage = await context.newPage();
  await freshPage.goto(detailUrl);
  await expect(freshPage.getByRole("heading", { name: new RegExp(`^${uniqueTitle}:`) }))
    .toBeVisible();
  await expect(freshPage.getByRole("heading", { name: "Issues", exact: true })).toHaveCount(0);

  await context.close();
});

test("selecting a trace updates the URL and survives reload", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const uniqueName = `e2e-deeplink-trace-${crypto.randomUUID().slice(0, 8)}`;
  const ingest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildTransactionEnvelope(crypto.randomUUID(), crypto.randomUUID(), uniqueName),
  });
  expect(ingest.status()).toBe(200);

  // Bounded wait for the queue consumer's async write (research.md §9, matching
  // traces-list-and-waterfall.spec.ts) — comfortably past max_batch_timeout (5s,
  // wrangler.jsonc), not an unbounded poll.
  await new Promise((resolve) => setTimeout(resolve, 7000));

  const token = await mintTestSession({
    sub: "e2e-deeplink-traces",
    email: "deeplink-traces@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await page.getByText("Traces", { exact: true }).click();
  const traceRow = page.getByText(uniqueName);
  await expect(traceRow).toBeVisible();
  await traceRow.click();

  await expect(page).toHaveURL(/\/web-app\/traces\/[^/]+$/);
  const detailUrl = page.url();
  await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

  await context.close();
});

test("selecting a release updates the URL and survives reload", async ({ browser, request, baseURL }) => {
  await ensureContractTestActor();
  const token = await mintTestSession({ ...CONTRACT_TEST_ACTOR, role: "member" });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();

  const tokenRes = await request.post("/api/internal/v1/projects/1/api-tokens", {
    headers: { Cookie: `fd_session=${token}` },
  });
  const { token: apiToken } = await tokenRes.json() as { id: string; token: string };

  const version = `e2e-deeplink-release-${crypto.randomUUID().slice(0, 8)}`;
  await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    data: { version, projects: ["1"] },
  });

  await page.goto("/");
  await page.getByText("Releases", { exact: true }).click();
  const releaseRow = page.getByText(version);
  await expect(releaseRow).toBeVisible();
  await releaseRow.click();

  await expect(page).toHaveURL(/\/web-app\/releases\/[^/]+$/);
  const detailUrl = page.url();
  await expect(page.getByRole("heading", { name: version })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { name: version })).toBeVisible();

  await context.close();
});

test("selecting an uptime check updates the URL and survives reload", async ({ browser, baseURL }) => {
  await ensureContractTestActor();
  const token = await mintTestSession({
    sub: CONTRACT_TEST_ACTOR.sub,
    email: CONTRACT_TEST_ACTOR.email,
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  const uniqueName = `e2e-deeplink-uptime-${crypto.randomUUID().slice(0, 8)}`;
  await page.getByText("Uptime", { exact: true }).click();
  await expect(page.getByText("Add a check")).toBeVisible();
  await page.getByPlaceholder("Name").fill(uniqueName);
  await page.getByPlaceholder("https://example.com", { exact: false }).fill("http://127.0.0.1:1");
  await page.getByRole("button", { name: "Add check" }).click();

  const checkRow = page.getByText(uniqueName);
  await expect(checkRow).toBeVisible();
  await checkRow.click();

  await expect(page).toHaveURL(/\/web-app\/uptime\/[^/]+$/);
  const detailUrl = page.url();
  await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

  await context.close();
});

test("selecting a feedback item updates the URL, survives reload, and supports back/forward", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();
  const uniqueMessage = `e2e-deeplink-feedback-${crypto.randomUUID().slice(0, 8)}`;
  const ingest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildFeedbackEnvelope(crypto.randomUUID(), uniqueMessage),
  });
  expect(ingest.status()).toBe(200);

  const token = await mintTestSession({
    sub: "e2e-deeplink-feedback",
    email: "deeplink-feedback@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await page.getByText("Feedback", { exact: true }).click();
  await expect(page).toHaveURL(/\/web-app\/feedback$/);
  const feedbackRow = page.getByText(uniqueMessage);
  await expect(feedbackRow).toBeVisible();
  await feedbackRow.click();

  await expect(page).toHaveURL(/\/web-app\/feedback\/[^/]+$/);
  const detailUrl = page.url();
  await expect(page.getByText(uniqueMessage)).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByText(uniqueMessage)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/web-app\/feedback$/);
  await expect(page.getByRole("heading", { name: "Feedback", exact: true })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByText(uniqueMessage)).toBeVisible();

  await context.close();
});
