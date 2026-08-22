import { assertEquals } from "@std/assert";
import {
  isEventItem,
  isLogItem,
  parseEnvelope,
  parseLogPayload,
} from "../../worker/modules/ingest/envelope.ts";
import {
  buildSearchText,
  distinctTraceIds,
  normalizeRecord,
} from "../../worker/modules/ingest/log-consumer.ts";
import type { RawLogRecord } from "../../worker/modules/ingest/log-consumer.ts";

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

Deno.test("isLogItem identifies a 'log' item and doesn't misclassify an 'event' item", () => {
  const logPayload = `{"items":[{"timestamp":1,"level":"info","body":"hi"}]}`;
  const eventPayload = `{"message":"hi"}`;
  const body = [
    `{"event_id":"x"}`,
    `{"type":"log","length":${bytesOf(logPayload).length}}`,
    logPayload,
    `{"type":"event","length":${bytesOf(eventPayload).length}}`,
    eventPayload,
  ].join("\n");

  const parsed = parseEnvelope(bytesOf(body));
  assertEquals(parsed?.items.length, 2);
  assertEquals(isLogItem(parsed!.items[0]), true);
  assertEquals(isEventItem(parsed!.items[0]), false);
  assertEquals(isLogItem(parsed!.items[1]), false);

  const decoded = parseLogPayload(parsed!.items[0]) as { items: RawLogRecord[] };
  assertEquals(decoded.items.length, 1);
  assertEquals(decoded.items[0].body, "hi");
});

Deno.test("normalizeRecord round-trips a raw record into the NDJSON-stored shape", () => {
  const raw: RawLogRecord = {
    timestamp: 1735689600,
    trace_id: "abc123",
    level: "info",
    body: "user checkout completed",
    attributes: {
      "user.id": { value: "usr_123", type: "string" },
      "order.total": { value: 42.5, type: "double" },
    },
  };
  const normalized = normalizeRecord(raw);
  assertEquals(normalized.level, "info");
  assertEquals(normalized.body, "user checkout completed");
  assertEquals(normalized.traceId, "abc123");
  assertEquals(normalized.attributes, { "user.id": "usr_123", "order.total": 42.5 });
  assertEquals(normalized.timestamp, new Date(1735689600 * 1000).toISOString());
});

Deno.test("normalizeRecord sets traceId null when trace_id is absent", () => {
  const raw: RawLogRecord = { timestamp: 1, level: "info", body: "no trace" };
  assertEquals(normalizeRecord(raw).traceId, null);
});

Deno.test("buildSearchText concatenates body plus string-typed attribute values only", () => {
  const records: RawLogRecord[] = [
    {
      timestamp: 1,
      level: "info",
      body: "checkout completed",
      attributes: {
        "user.id": { value: "usr_123", type: "string" },
        "order.total": { value: 42.5, type: "double" },
      },
    },
    { timestamp: 2, level: "error", body: "payment failed" },
  ];
  const text = buildSearchText(records);
  assertEquals(text.includes("checkout completed"), true);
  assertEquals(text.includes("usr_123"), true);
  assertEquals(text.includes("42.5"), false); // double-typed, not string-typed — excluded
  assertEquals(text.includes("payment failed"), true);
});

Deno.test("distinctTraceIds returns each trace_id once, even with repeats, ignoring records with none", () => {
  const records: RawLogRecord[] = [
    { timestamp: 1, level: "info", body: "a", trace_id: "t1" },
    { timestamp: 2, level: "info", body: "b", trace_id: "t1" },
    { timestamp: 3, level: "info", body: "c", trace_id: "t2" },
    { timestamp: 4, level: "info", body: "d" },
  ];
  const ids = distinctTraceIds(records);
  assertEquals(ids.sort(), ["t1", "t2"]);
});
