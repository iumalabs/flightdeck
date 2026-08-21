import { assertEquals } from "@std/assert";
import { extractSentryKey, resolveProjectByDsnKey } from "../../worker/modules/ingest/dsn-auth.ts";

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
  const db = new FakeD1([{ id: "demo", dsn_public_key: "abc123" }]);
  const result = await resolveProjectByDsnKey(db as unknown as D1Database, "demo", "abc123");
  assertEquals(result, { id: "demo" });
});

Deno.test("resolveProjectByDsnKey returns null for an unknown key", async () => {
  const db = new FakeD1([{ id: "demo", dsn_public_key: "abc123" }]);
  const result = await resolveProjectByDsnKey(db as unknown as D1Database, "demo", "wrong-key");
  assertEquals(result, null);
});

Deno.test("resolveProjectByDsnKey rejects project_id 'internal' outright", async () => {
  const db = new FakeD1([{ id: "internal", dsn_public_key: "abc123" }]);
  const result = await resolveProjectByDsnKey(db as unknown as D1Database, "internal", "abc123");
  assertEquals(result, null);
});
