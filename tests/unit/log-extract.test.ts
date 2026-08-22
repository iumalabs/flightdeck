import { assertEquals } from "@std/assert";
import { filterRecords, parseNdjson } from "../../worker/modules/logs/extract.ts";
import type { LogRecord } from "../../worker/modules/logs/extract.ts";

function ndjsonOf(records: LogRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

function record(overrides: Partial<LogRecord>): LogRecord {
  return {
    timestamp: "2026-08-22T12:00:00.000Z",
    level: "info",
    body: "default body",
    attributes: {},
    traceId: null,
    ...overrides,
  };
}

Deno.test("parseNdjson parses one record per line", () => {
  const records = [record({ body: "first" }), record({ body: "second" })];
  const parsed = parseNdjson(ndjsonOf(records));
  assertEquals(parsed.length, 2);
  assertEquals(parsed[0].body, "first");
  assertEquals(parsed[1].body, "second");
});

Deno.test("parseNdjson skips a malformed line without failing the rest", () => {
  const text = `${JSON.stringify(record({ body: "ok" }))}\nnot json\n${
    JSON.stringify(record({ body: "also ok" }))
  }`;
  const parsed = parseNdjson(text);
  assertEquals(parsed.length, 2);
  assertEquals(parsed.map((r) => r.body), ["ok", "also ok"]);
});

Deno.test("filterRecords finds a distinctive text query, case-insensitively, and excludes non-matches", () => {
  const records = [
    record({ body: "user checkout completed" }),
    record({ body: "database connection timeout" }),
  ];
  const matched = filterRecords(records, { q: "CHECKOUT" });
  assertEquals(matched.length, 1);
  assertEquals(matched[0].body, "user checkout completed");
});

Deno.test("filterRecords matches a query against string attribute values too", () => {
  const records = [record({ body: "unrelated", attributes: { userId: "usr_abc123" } })];
  assertEquals(filterRecords(records, { q: "abc123" }).length, 1);
});

Deno.test("filterRecords filters by level", () => {
  const records = [record({ level: "info" }), record({ level: "error" })];
  const matched = filterRecords(records, { level: "error" });
  assertEquals(matched.length, 1);
  assertEquals(matched[0].level, "error");
});

Deno.test("filterRecords filters by time range (inclusive)", () => {
  const records = [
    record({ timestamp: "2026-08-22T10:00:00.000Z" }),
    record({ timestamp: "2026-08-22T12:00:00.000Z" }),
    record({ timestamp: "2026-08-22T14:00:00.000Z" }),
  ];
  const matched = filterRecords(records, {
    from: "2026-08-22T11:00:00.000Z",
    to: "2026-08-22T13:00:00.000Z",
  });
  assertEquals(matched.length, 1);
  assertEquals(matched[0].timestamp, "2026-08-22T12:00:00.000Z");
});

Deno.test("filterRecords returns an empty result gracefully for no matches", () => {
  const records = [record({ body: "hello" })];
  assertEquals(filterRecords(records, { q: "nonexistent-term" }), []);
});

Deno.test("filterRecords filters by traceId, for trace-linkage lookups", () => {
  const records = [record({ traceId: "t1" }), record({ traceId: "t2" }), record({ traceId: null })];
  assertEquals(filterRecords(records, { traceId: "t1" }).length, 1);
});

Deno.test("toFts5MatchLiteral quotes a hyphenated query so it's not parsed as FTS5 NOT-syntax", async () => {
  const { toFts5MatchLiteral } = await import("../../worker/modules/logs/routes.ts");
  assertEquals(toFts5MatchLiteral("zzz-nonexistent-zzz"), '"zzz-nonexistent-zzz"');
});

Deno.test("toFts5MatchLiteral escapes a literal double-quote by doubling it", async () => {
  const { toFts5MatchLiteral } = await import("../../worker/modules/logs/routes.ts");
  assertEquals(toFts5MatchLiteral('say "hi"'), '"say ""hi"""');
});
