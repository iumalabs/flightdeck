import { expect, test } from "@playwright/test";
import { mintTestSession } from "./support/session.ts";
import { getDsnKey } from "../contract/support/dsn-key.ts";

// spec.md User Story 3 (issue-detail cross-linking), end to end through the actual UI: seeds one
// real error event with linked feedback and one without, via the public envelope endpoint, then
// confirms the Feedback list shows both and IssueDetailScreen.tsx shows a feedback section only for
// the linked one.

function buildErrorEnvelope(eventId: string, uniqueTitle: string): string {
  const payload = {
    event_id: eventId,
    level: "error",
    exception: {
      values: [{
        type: uniqueTitle,
        value: "seeded for feedback-list-and-linking.spec.ts",
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

function buildFeedbackEnvelope(
  eventId: string,
  message: string,
  associatedEventId: string,
): string {
  const payloadJson = JSON.stringify({
    event_id: eventId,
    contexts: { feedback: { message, associated_event_id: associatedEventId } },
  });
  const payloadBytes = new TextEncoder().encode(payloadJson).length;
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({ type: "feedback", length: payloadBytes });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

test("an issue with linked feedback shows a feedback section; one with none shows no section", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();

  const linkedErrorEventId = crypto.randomUUID();
  const linkedTitle = `e2e-feedback-linked-${linkedErrorEventId.slice(0, 8)}`;
  const errIngest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildErrorEnvelope(linkedErrorEventId, linkedTitle),
  });
  expect(errIngest.status()).toBe(200);

  const unlinkedErrorEventId = crypto.randomUUID();
  const unlinkedTitle = `e2e-feedback-none-${unlinkedErrorEventId.slice(0, 8)}`;
  const errIngest2 = await request.post(
    `/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    {
      data: buildErrorEnvelope(unlinkedErrorEventId, unlinkedTitle),
    },
  );
  expect(errIngest2.status()).toBe(200);

  const uniqueFeedbackMessage = `e2e feedback message ${linkedErrorEventId.slice(0, 8)}`;
  const fbIngest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildFeedbackEnvelope(crypto.randomUUID(), uniqueFeedbackMessage, linkedErrorEventId),
  });
  expect(fbIngest.status()).toBe(200);

  const token = await mintTestSession({
    sub: "e2e-feedback-linking",
    email: "feedback-linking@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  // Feedback list shows the standalone submission.
  await page.getByText("Feedback", { exact: true }).click();
  await expect(page.getByText(uniqueFeedbackMessage)).toBeVisible();

  // The linked issue's detail view shows the feedback section.
  await page.getByText("Issues", { exact: true }).click();
  const linkedIssueRow = page.getByText(new RegExp(`^${linkedTitle}:`));
  await expect(linkedIssueRow).toBeVisible();
  await linkedIssueRow.click();
  await expect(page.getByText("User feedback")).toBeVisible();
  await expect(page.getByText(uniqueFeedbackMessage)).toBeVisible();

  // An issue with no linked feedback shows no feedback section at all.
  await page.getByText("Issues", { exact: true }).click();
  const unlinkedIssueRow = page.getByText(new RegExp(`^${unlinkedTitle}:`));
  await expect(unlinkedIssueRow).toBeVisible();
  await unlinkedIssueRow.click();
  await expect(page.getByText("User feedback")).not.toBeVisible();

  await context.close();
});

// Regression test for issue #115: FeedbackDetailView rendered a feedback item's linked issue title
// as inert text with no way to navigate to it, unlike every other cross-screen reference in the
// app. Seeds a linked error + feedback pair, opens the feedback item's own detail view (not the
// issue's, which the first test above already covers), and confirms clicking the linked-issue text
// navigates to that issue's detail view.
test("clicking a feedback item's linked issue navigates to that issue's detail view", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();

  const linkedErrorEventId = crypto.randomUUID();
  const linkedTitle = `e2e-feedback-detail-link-${linkedErrorEventId.slice(0, 8)}`;
  const errIngest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildErrorEnvelope(linkedErrorEventId, linkedTitle),
  });
  expect(errIngest.status()).toBe(200);

  const uniqueFeedbackMessage = `e2e feedback detail-link message ${
    linkedErrorEventId.slice(0, 8)
  }`;
  const fbIngest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildFeedbackEnvelope(crypto.randomUUID(), uniqueFeedbackMessage, linkedErrorEventId),
  });
  expect(fbIngest.status()).toBe(200);

  const token = await mintTestSession({
    sub: "e2e-feedback-detail-link",
    email: "feedback-detail-link@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/");

  await page.getByText("Feedback", { exact: true }).click();
  await page.getByText(uniqueFeedbackMessage).click();

  const linkedIssueLink = page.getByText(linkedTitle);
  await expect(linkedIssueLink).toBeVisible();
  await linkedIssueLink.click();

  await expect(page).toHaveURL(/\/web-app\/issues\//);
  await expect(page.getByRole("heading", { name: linkedTitle })).toBeVisible();

  await context.close();
});

// Regression test for issue #103: the feedback row's message span was the only flexible column
// (`flex: 1, minWidth: 0`), while the trailing timestamp span had no width constraint and rendered
// at its natural, unpredictable width. At narrower viewports the fixed/natural-width columns
// (source + linked/standalone + timestamp) could consume the entire row, leaving flexbox nothing
// to give the message span — it shrank all the way to 0px and the message text disappeared
// entirely instead of ellipsizing. Reproduces the issue's exact 616px repro viewport.
test("the feedback message stays visible (ellipsized, not collapsed to 0px) at a narrow viewport", async ({ browser, request, baseURL }) => {
  const dsnKey = await getDsnKey();

  const uniqueId = crypto.randomUUID().slice(0, 8);
  const uniqueFeedbackMessage =
    `e2e narrow-viewport feedback message ${uniqueId} — long enough to require ellipsis truncation once the row is squeezed by its fixed-width sibling columns`;
  const fbIngest = await request.post(`/api/1/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: buildFeedbackEnvelope(crypto.randomUUID(), uniqueFeedbackMessage, ""),
  });
  expect(fbIngest.status()).toBe(200);

  const token = await mintTestSession({
    sub: "e2e-feedback-narrow",
    email: "feedback-narrow@example.com",
    role: "member",
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fd_session", value: token, url: baseURL!, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.setViewportSize({ width: 616, height: 743 });
  await page.goto("/");

  await page.getByText("Feedback", { exact: true }).click();

  const messageSpan = page.getByText(uniqueFeedbackMessage);
  await expect(messageSpan).toBeVisible();
  const box = await messageSpan.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);

  await context.close();
});
