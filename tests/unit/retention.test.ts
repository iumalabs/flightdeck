import { assertEquals } from "@std/assert";
import {
  pruneOldEvents,
  pruneOldTransactions,
  RETENTION_DAYS,
  TRANSACTION_RETENTION_DAYS,
} from "../../worker/modules/ingest/retention.ts";

class FakeD1 {
  lastSql: string | null = null;
  lastBinding: unknown = null;
  #changes: number;
  constructor(changes: number) {
    this.#changes = changes;
  }
  prepare = (sql: string) => {
    this.lastSql = sql;
    return {
      bind: (...args: unknown[]) => {
        this.lastBinding = args[0];
        return { run: () => Promise.resolve({ meta: { changes: this.#changes } }) };
      },
    };
  };
}

Deno.test("pruneOldEvents deletes from the events table only, never issues", async () => {
  const db = new FakeD1(0);
  await pruneOldEvents(db as unknown as D1Database);
  assertEquals(db.lastSql?.includes("DELETE FROM events"), true);
  assertEquals(db.lastSql?.toLowerCase().includes("issues"), false);
});

Deno.test("pruneOldEvents binds the configured retention window as a negative-day offset", async () => {
  const db = new FakeD1(0);
  await pruneOldEvents(db as unknown as D1Database);
  assertEquals(db.lastBinding, `-${RETENTION_DAYS} days`);
});

Deno.test("pruneOldEvents returns the number of rows deleted", async () => {
  const db = new FakeD1(7) as unknown as D1Database;
  const deleted = await pruneOldEvents(db);
  assertEquals(deleted, 7);
});

Deno.test("pruneOldEvents returns 0 when nothing was old enough to delete", async () => {
  const db = new FakeD1(0) as unknown as D1Database;
  const deleted = await pruneOldEvents(db);
  assertEquals(deleted, 0);
});

// specs/003-distributed-tracing research.md §8: transactions get their own, shorter window — a
// separate function/query from pruneOldEvents, never touching the events table.
Deno.test("pruneOldTransactions deletes from the transactions table only, never events", async () => {
  const db = new FakeD1(0);
  await pruneOldTransactions(db as unknown as D1Database);
  assertEquals(db.lastSql?.includes("DELETE FROM transactions"), true);
  assertEquals(db.lastSql?.toLowerCase().includes("events"), false);
});

Deno.test("pruneOldTransactions binds its own, shorter retention window", async () => {
  const db = new FakeD1(0);
  await pruneOldTransactions(db as unknown as D1Database);
  assertEquals(db.lastBinding, `-${TRANSACTION_RETENTION_DAYS} days`);
  assertEquals(TRANSACTION_RETENTION_DAYS < RETENTION_DAYS, true);
});

Deno.test("pruneOldTransactions returns the number of rows deleted", async () => {
  const db = new FakeD1(4) as unknown as D1Database;
  const deleted = await pruneOldTransactions(db);
  assertEquals(deleted, 4);
});
