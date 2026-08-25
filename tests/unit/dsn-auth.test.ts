import { assertEquals } from "@std/assert";
import {
  extractSentryKey,
  isNumericProjectId,
  resolveProjectByDsnKey,
} from "../../worker/modules/ingest/dsn-auth.ts";

Deno.test("extractSentryKey reads the key from the X-Sentry-Auth header", () => {
  const request = new Request("https://flightdeck.iuma.dev/api/demo/envelope/", {
    headers: {
      "X-Sentry-Auth":
        "Sentry sentry_version=7, sentry_client=sentry.python/1.0, sentry_key=abc123",
    },
  });
  assertEquals(extractSentryKey(request), "abc123");
});

Deno.test("extractSentryKey reads the key from the query string", () => {
  const request = new Request(
    "https://flightdeck.iuma.dev/api/demo/envelope/?sentry_version=7&sentry_key=abc123",
  );
  assertEquals(extractSentryKey(request), "abc123");
});

Deno.test("extractSentryKey accepts matching header and query values", () => {
  const request = new Request("https://flightdeck.iuma.dev/api/demo/envelope/?sentry_key=abc123", {
    headers: { "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=abc123" },
  });
  assertEquals(extractSentryKey(request), "abc123");
});

Deno.test("extractSentryKey rejects a mismatch between header and query values", () => {
  const request = new Request("https://flightdeck.iuma.dev/api/demo/envelope/?sentry_key=abc123", {
    headers: { "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=xyz789" },
  });
  assertEquals(extractSentryKey(request), null);
});

Deno.test("extractSentryKey returns null when neither is present", () => {
  const request = new Request("https://flightdeck.iuma.dev/api/demo/envelope/");
  assertEquals(extractSentryKey(request), null);
});

// Minimal fake D1 — same pattern as tests/unit/identity-users.test.ts.
class FakeD1 {
  rows: Array<{ id: string; dsn_public_key: string }>;
  constructor(rows: Array<{ id: string; dsn_public_key: string }>) {
    this.rows = rows;
  }
  prepare(_sql: string) {
    const rows = this.rows;
    let params: unknown[] = [];
    return {
      bind(...args: unknown[]) {
        params = args;
        return this;
      },
      first<T>() {
        const [projectId, key] = params as [string, string];
        const row = rows.find((r) => r.id === projectId && r.dsn_public_key === key);
        // The real driver only returns the columns the SQL's SELECT list names — mimic that
        // instead of handing back the fake's whole internal row shape.
        return Promise.resolve(row ? { id: row.id } as T : null);
      },
    };
  }
}

Deno.test("resolveProjectByDsnKey resolves a matching project/key pair", async () => {
  const db = new FakeD1([{ id: "1", dsn_public_key: "abc123" }]);
  const result = await resolveProjectByDsnKey(db as unknown as D1Database, "1", "abc123");
  assertEquals(result, { id: "1" });
});

Deno.test("resolveProjectByDsnKey returns null for an unknown key", async () => {
  const db = new FakeD1([{ id: "1", dsn_public_key: "abc123" }]);
  const result = await resolveProjectByDsnKey(db as unknown as D1Database, "1", "wrong-key");
  assertEquals(result, null);
});

Deno.test("resolveProjectByDsnKey rejects project_id 'internal' outright", async () => {
  const db = new FakeD1([{ id: "internal", dsn_public_key: "abc123" }]);
  const result = await resolveProjectByDsnKey(db as unknown as D1Database, "internal", "abc123");
  assertEquals(result, null);
});

// migration 0009: `projects.id` is now a genuinely numeric INTEGER PRIMARY KEY — a UUID-shaped (or
// any other non-numeric) project id must never reach the DB query at all, matching the real
// @sentry/core SDK's own /^\d+$/ DSN project-id validation.
Deno.test("resolveProjectByDsnKey rejects a non-numeric project id, even with a matching key", async () => {
  const db = new FakeD1([{ id: "1", dsn_public_key: "abc123" }]);
  const result = await resolveProjectByDsnKey(
    db as unknown as D1Database,
    "0d1f8b2a-uuid-shaped",
    "abc123",
  );
  assertEquals(result, null);
});

Deno.test("isNumericProjectId accepts a clean positive integer string", () => {
  assertEquals(isNumericProjectId("1"), true);
  assertEquals(isNumericProjectId("42"), true);
  assertEquals(isNumericProjectId("1000000"), true);
});

Deno.test("isNumericProjectId rejects non-numeric, zero, negative, and leading-zero strings", () => {
  assertEquals(isNumericProjectId("demo"), false);
  assertEquals(isNumericProjectId("0d1f8b2a-1234-4abc-9def-1234567890ab"), false);
  assertEquals(isNumericProjectId("0"), false);
  assertEquals(isNumericProjectId("-1"), false);
  assertEquals(isNumericProjectId("01"), false);
  assertEquals(isNumericProjectId("1.0"), false);
  assertEquals(isNumericProjectId(""), false);
  assertEquals(isNumericProjectId(" 1"), false);
});
