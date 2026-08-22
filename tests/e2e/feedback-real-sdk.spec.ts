import { expect, test } from "@playwright/test";
import { getDsnKey } from "../contract/support/dsn-key.ts";

// quickstart.md's "Real-SDK validation" step, automated rather than left purely manual: loads the
// REAL, unmodified @sentry/browser UMD bundle from its actual CDN (browser.sentry-cdn.com — the
// same artifact a real customer's <script> tag would load, not a hand-rolled approximation) into a
// live browser page, points it at this project's DSN, and calls the SDK's own
// `Sentry.showReportDialog({ eventId })` — confirming the dialog's script-injection request lands
// on FlightDeck's endpoint and the injected script executes without error. This is the SC-002-grade
// verification research.md §1 calls for: the real SDK's own request/response contract, not a
// hand-crafted contract-test approximation of it.

test("Sentry.showReportDialog() from the real, unmodified SDK loads FlightDeck's dialog script", async ({ page, baseURL }) => {
  const dsnKey = await getDsnKey();
  const host = new URL(baseURL!).host;
  const dsn = `http://${dsnKey}@${host}/demo`;

  // A real page, not "about:blank" — cross-origin <script src> injection (what showReportDialog()
  // itself does internally) does not reliably execute against the null/opaque origin
  // "about:blank" gives (found live: the dialog script's own network request still fired and
  // returned 200, but its DOM injection silently never ran).
  await page.goto(baseURL!);
  await page.addScriptTag({ url: "https://browser.sentry-cdn.com/7.120.3/bundle.min.js" });
  await page.waitForFunction(() =>
    typeof (globalThis as { Sentry?: unknown }).Sentry !== "undefined"
  );

  const requestPromise = page.waitForRequest((req) => req.url().includes("/api/embed/error-page"));

  const eventId = crypto.randomUUID().replace(/-/g, "");
  await page.evaluate(
    ({ dsn, eventId }) => {
      // deno-lint-ignore no-explicit-any
      const Sentry = (globalThis as any).Sentry;
      Sentry.init({ dsn });
      Sentry.showReportDialog({ eventId });
    },
    { dsn, eventId },
  );

  const dialogRequest = await requestPromise;
  expect(dialogRequest.url()).toContain("eventId=" + eventId);
  expect(dialogRequest.url()).toContain("dsn=");

  // The real SDK injects a <script> tag pointed at this URL and relies on it loading successfully
  // (script.onload) — confirm FlightDeck's own dialog markup actually landed in the page.
  await expect(page.locator("#fd-feedback-form")).toBeAttached({ timeout: 5000 });
});
