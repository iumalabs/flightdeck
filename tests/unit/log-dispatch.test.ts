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
  handleLogIngestBatch,
  normalizeRecord,
} from "../../worker/modules/ingest/log-consumer.ts";
import type { QueuedLogBatch, RawLogRecord } from "../../worker/modules/ingest/log-consumer.ts";

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

// --- T044: submission-level de-duplication (specs/004-structured-logs data-model.md's Log Batch
// validation rules) --------------------------------------------------------------------------

// Minimal fakes mirroring tests/unit/feedback-ingest.test.ts's FakeD1 pattern — positional args
// matched against the real handleLogIngestBatch SQL, not a general-purpose SQL engine.
class FakeLogD1 {
  batchRows: { id: string; project_id: string; envelope_event_id: string | null }[] = [];
  ftsRows: { search_text: string; batch_id: string }[] = [];
  traceRows: { batch_id: string; trace_id: string }[] = [];

  prepare = (sql: string) => {
    return {
      bind: (...args: unknown[]) => ({
        first: <T>(): Promise<T | null> => {
          if (sql.includes("SELECT 1 FROM log_batches")) {
            const [projectId, envelopeEventId] = args as [string, string];
            const exists = this.batchRows.some((b) =>
              b.project_id === projectId && b.envelope_event_id === envelopeEventId
            );
            return Promise.resolve((exists ? { 1: 1 } : null) as T | null);
          }
          return Promise.resolve(null);
        },
        // Exposed for FakeLogD1's own batch() to apply — real D1's PreparedStatement has no such
        // method; this fake stands in for it.
        _apply: () => {
          if (
            sql.startsWith("INSERT INTO log_batches\n") ||
            sql.startsWith("INSERT INTO log_batches ")
          ) {
            const [id, projectId, , , , , , envelopeEventId] = args as [
              string,
              string,
              string,
              string,
              string,
              number,
              string,
              string | null,
            ];
            this.batchRows.push({ id, project_id: projectId, envelope_event_id: envelopeEventId });
          } else if (sql.startsWith("INSERT INTO log_batches_fts")) {
            const [searchText, batchId] = args as [string, string];
            this.ftsRows.push({ search_text: searchText, batch_id: batchId });
          } else if (sql.startsWith("INSERT INTO log_batch_traces")) {
            const [batchId, traceId] = args as [string, string];
            this.traceRows.push({ batch_id: batchId, trace_id: traceId });
          }
        },
      }),
    };
  };

  batch = (
    statements: { bind: (...args: unknown[]) => { _apply: () => void } }[],
  ) => {
    for (const stmt of statements as unknown as { _apply: () => void }[]) {
      stmt._apply();
    }
    return Promise.resolve([]);
  };
}

class FakeLogR2 {
  putCalls: string[] = [];
  put = (key: string, _value: string) => {
    this.putCalls.push(key);
    return Promise.resolve();
  };
}

function fakeMessageBatch(
  bodies: QueuedLogBatch[],
): { batch: MessageBatch<QueuedLogBatch>; acked: number[]; retried: number[] } {
  const acked: number[] = [];
  const retried: number[] = [];
  const messages = bodies.map((body, i) => ({
    body,
    ack: () => acked.push(i),
    retry: () => retried.push(i),
  }));
  return {
    batch: { messages } as unknown as MessageBatch<QueuedLogBatch>,
    acked,
    retried,
  };
}

Deno.test("handleLogIngestBatch writes one log_batches + log_batches_fts row for a fresh submission", async () => {
  const db = new FakeLogD1();
  const r2 = new FakeLogR2();
  const records: RawLogRecord[] = [{ timestamp: 1, level: "info", body: "hello" }];
  const { batch, acked, retried } = fakeMessageBatch([
    { projectId: "demo", records, envelopeEventId: "env-evt-1" },
  ]);

  await handleLogIngestBatch(
    batch,
    { DB: db as unknown as D1Database, LOGS: r2 as unknown as R2Bucket },
  );

  assertEquals(db.batchRows.length, 1);
  assertEquals(db.ftsRows.length, 1);
  assertEquals(acked, [0]);
  assertEquals(retried, []);
});

Deno.test("handleLogIngestBatch does not duplicate a log_batches/log_batches_fts row when the same envelopeEventId is processed twice", async () => {
  const db = new FakeLogD1();
  const r2 = new FakeLogR2();
  const records: RawLogRecord[] = [{ timestamp: 1, level: "info", body: "retried submission" }];
  const body: QueuedLogBatch = { projectId: "demo", records, envelopeEventId: "env-evt-dup" };

  // First delivery — a fresh submission.
  const first = fakeMessageBatch([body]);
  await handleLogIngestBatch(
    first.batch,
    { DB: db as unknown as D1Database, LOGS: r2 as unknown as R2Bucket },
  );

  // Second delivery of the SAME envelope submission — a client retry, or Cloudflare Queues'
  // at-least-once redelivery of the same message.
  const second = fakeMessageBatch([body]);
  await handleLogIngestBatch(
    second.batch,
    { DB: db as unknown as D1Database, LOGS: r2 as unknown as R2Bucket },
  );

  assertEquals(db.batchRows.length, 1); // no duplicate log_batches row
  assertEquals(db.ftsRows.length, 1); // no duplicate FTS row -> no duplicate search results
  assertEquals(second.acked, [0]); // the duplicate is acknowledged, not retried forever
  assertEquals(second.retried, []);
});

Deno.test("handleLogIngestBatch still writes every time when envelopeEventId is absent (nothing to dedup on)", async () => {
  const db = new FakeLogD1();
  const r2 = new FakeLogR2();
  const records: RawLogRecord[] = [{ timestamp: 1, level: "info", body: "no envelope id" }];
  const body: QueuedLogBatch = { projectId: "demo", records, envelopeEventId: null };

  const first = fakeMessageBatch([body]);
  await handleLogIngestBatch(
    first.batch,
    { DB: db as unknown as D1Database, LOGS: r2 as unknown as R2Bucket },
  );
  const second = fakeMessageBatch([body]);
  await handleLogIngestBatch(
    second.batch,
    { DB: db as unknown as D1Database, LOGS: r2 as unknown as R2Bucket },
  );

  assertEquals(db.batchRows.length, 2); // no identifier to dedup on -> both are written
});
