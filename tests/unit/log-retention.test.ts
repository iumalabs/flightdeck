import { assertEquals } from "@std/assert";
import { LOG_RETENTION_DAYS, pruneOldLogBatches } from "../../worker/modules/ingest/retention.ts";
import {
  RETENTION_DAYS,
  TRANSACTION_RETENTION_DAYS,
} from "../../worker/modules/ingest/retention.ts";

interface FakeRow {
  id: string;
  r2_object_key: string;
}

class FakeLogsD1 {
  batchCalls: string[][] = [];
  #rows: FakeRow[];
  constructor(rows: FakeRow[]) {
    this.#rows = rows;
  }
  prepare = (_sql: string) => ({
    bind: (..._args: unknown[]) => ({
      all: () => Promise.resolve({ results: this.#rows }),
    }),
  });
  batch = (statements: { sql?: string }[]) => {
    // Each "statement" here is the object returned by prepare().bind() in pruneOldLogBatches —
    // record enough to assert against without needing a real D1PreparedStatement shape.
    this.batchCalls.push(statements.map((_s, i) => `stmt${i}`));
    return Promise.resolve([]);
  };
}

class FakeLogsR2 {
  deleted: string[] = [];
  delete = (key: string) => {
    this.deleted.push(key);
    return Promise.resolve();
  };
}

Deno.test("pruneOldLogBatches deletes the R2 object for every pruned batch", async () => {
  const db = new FakeLogsD1([
    { id: "b1", r2_object_key: "demo/2026/08/01/00/b1.ndjson" },
    { id: "b2", r2_object_key: "demo/2026/08/01/00/b2.ndjson" },
  ]);
  const bucket = new FakeLogsR2();
  await pruneOldLogBatches(db as unknown as D1Database, bucket as unknown as R2Bucket);
  assertEquals(bucket.deleted.sort(), [
    "demo/2026/08/01/00/b1.ndjson",
    "demo/2026/08/01/00/b2.ndjson",
  ]);
});

Deno.test("pruneOldLogBatches issues one db.batch() call covering log_batches, fts, and junction rows", async () => {
  const db = new FakeLogsD1([{ id: "b1", r2_object_key: "k" }]);
  const bucket = new FakeLogsR2();
  await pruneOldLogBatches(db as unknown as D1Database, bucket as unknown as R2Bucket);
  assertEquals(db.batchCalls.length, 1);
  assertEquals(db.batchCalls[0].length, 3); // log_batches + log_batches_fts + log_batch_traces
});

Deno.test("pruneOldLogBatches returns 0 and skips R2/D1 writes when nothing is old enough", async () => {
  const db = new FakeLogsD1([]);
  const bucket = new FakeLogsR2();
  const deleted = await pruneOldLogBatches(
    db as unknown as D1Database,
    bucket as unknown as R2Bucket,
  );
  assertEquals(deleted, 0);
  assertEquals(bucket.deleted, []);
  assertEquals(db.batchCalls.length, 0);
});

Deno.test("pruneOldLogBatches returns the number of batches pruned", async () => {
  const db = new FakeLogsD1([
    { id: "b1", r2_object_key: "k1" },
    { id: "b2", r2_object_key: "k2" },
    { id: "b3", r2_object_key: "k3" },
  ]);
  const bucket = new FakeLogsR2();
  const deleted = await pruneOldLogBatches(
    db as unknown as D1Database,
    bucket as unknown as R2Bucket,
  );
  assertEquals(deleted, 3);
});

Deno.test("LOG_RETENTION_DAYS is the shortest window of any module (shorter than events and transactions)", () => {
  assertEquals(LOG_RETENTION_DAYS < TRANSACTION_RETENTION_DAYS, true);
  assertEquals(LOG_RETENTION_DAYS < RETENTION_DAYS, true);
});
