import { assertEquals } from "@std/assert";
import { insertWidgetFeedback, resolveIssueId } from "../../worker/modules/feedback/ingest.ts";

class FakeD1 {
  events = new Map<string, { issue_id: string }>(); // keyed by sdk_event_id
  feedbackSdkEventIds = new Set<string>();
  inserted: Record<string, unknown>[] = [];

  prepare = (sql: string) => {
    return {
      bind: (...args: unknown[]) => ({
        first: <T>(): Promise<T | null> => {
          if (sql.includes("FROM events")) {
            const sdkEventId = args[1] as string;
            const row = this.events.get(sdkEventId);
            return Promise.resolve((row ?? null) as T | null);
          }
          if (sql.includes("SELECT 1 FROM feedback")) {
            const sdkEventId = args[1] as string;
            return Promise.resolve(
              (this.feedbackSdkEventIds.has(sdkEventId) ? { 1: 1 } : null) as
                | T
                | null,
            );
          }
          return Promise.resolve(null);
        },
        run: () => {
          if (sql.startsWith("INSERT INTO feedback")) {
            this.inserted.push({ args });
            const sdkEventId = args[8] as string | null;
            if (sdkEventId) this.feedbackSdkEventIds.add(sdkEventId);
          }
          return Promise.resolve({ meta: { changes: 1 } });
        },
      }),
    };
  };
}

Deno.test("resolveIssueId resolves associated_event_id against events.sdk_event_id", async () => {
  const db = new FakeD1();
  db.events.set("evt-1", { issue_id: "issue-1" });
  const issueId = await resolveIssueId(db as unknown as D1Database, "demo", "evt-1");
  assertEquals(issueId, "issue-1");
});

Deno.test("resolveIssueId returns null when associated_event_id doesn't resolve (not rejected)", async () => {
  const db = new FakeD1();
  const issueId = await resolveIssueId(db as unknown as D1Database, "demo", "unknown-evt");
  assertEquals(issueId, null);
});

Deno.test("resolveIssueId returns null when associated_event_id is absent", async () => {
  const db = new FakeD1();
  const issueId = await resolveIssueId(db as unknown as D1Database, "demo", null);
  assertEquals(issueId, null);
});

Deno.test("insertWidgetFeedback records standalone feedback with no associated_event_id", async () => {
  const db = new FakeD1();
  await insertWidgetFeedback(db as unknown as D1Database, "demo", {
    message: "Something looked broken here",
    name: null,
    contactEmail: null,
    url: null,
    associatedEventId: null,
    sdkEventId: "fb-evt-1",
  });
  assertEquals(db.inserted.length, 1);
});

Deno.test("insertWidgetFeedback dedups by the item's own event_id, not a second row", async () => {
  const db = new FakeD1();
  const input = {
    message: "duplicate submission",
    name: null,
    contactEmail: null,
    url: null,
    associatedEventId: null,
    sdkEventId: "fb-evt-dup",
  };
  await insertWidgetFeedback(db as unknown as D1Database, "demo", input);
  await insertWidgetFeedback(db as unknown as D1Database, "demo", input);
  assertEquals(db.inserted.length, 1);
});
