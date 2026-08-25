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
