import { assertEquals } from "@std/assert";
import {
  createCheck,
  MAX_CHECKS_PER_PROJECT,
  MIN_INTERVAL_SECONDS,
} from "../../worker/modules/uptime/create-check.ts";

// T040 (specs/006-uptime-monitoring tasks.md): MIN_INTERVAL_SECONDS used to only be re-validated
// independently by routes.ts's POST /checks and PATCH /checks/:id handlers — createCheck() itself
// enforced MAX_CHECKS_PER_PROJECT but not the interval floor, so a future direct caller (like
// default-checks.ts's seeding path) that passed a bad interval would slip through uncaught. These
// tests prove createCheck() now rejects it by construction, not by convention — directly, with no
// route layer involved.

class FakeD1 {
  count: number;
  inserted: unknown[][] = [];
  countQueried = false;

  constructor(count = 0) {
    this.count = count;
  }

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        first: <T>(): Promise<T | null> => {
          if (sql.includes("SELECT COUNT(*)")) {
            this.countQueried = true;
            return Promise.resolve({ count: this.count } as unknown as T);
          }
          return Promise.resolve(null as T | null);
        },
        run: () => {
          if (sql.startsWith("INSERT INTO checks")) {
            this.inserted.push(args);
          }
          return Promise.resolve({ meta: { changes: 1 } });
        },
      }),
    };
  }
}

function makeInput(overrides: Partial<Parameters<typeof createCheck>[2]> = {}) {
  return {
    name: "demo",
    type: "http" as const,
    target: "https://example.com",
    intervalSeconds: MIN_INTERVAL_SECONDS,
    ...overrides,
  };
}

Deno.test("createCheck rejects an interval below MIN_INTERVAL_SECONDS with 'interval-too-low'", async () => {
  const db = new FakeD1();
  const result = await createCheck(
    db as unknown as D1Database,
    "project-1",
    makeInput({ intervalSeconds: MIN_INTERVAL_SECONDS - 1 }),
  );
  assertEquals(result, "interval-too-low");
});

Deno.test("createCheck's interval rejection never inserts a row and never even queries the check count", async () => {
  const db = new FakeD1();
  await createCheck(
    db as unknown as D1Database,
    "project-1",
    makeInput({ intervalSeconds: 30 }),
  );
  assertEquals(db.inserted.length, 0);
  assertEquals(db.countQueried, false);
});

Deno.test("createCheck accepts an interval exactly at MIN_INTERVAL_SECONDS", async () => {
  const db = new FakeD1();
  const result = await createCheck(
    db as unknown as D1Database,
    "project-1",
    makeInput({ intervalSeconds: MIN_INTERVAL_SECONDS }),
  );
  assertEquals(typeof result === "object" && result !== null, true);
  assertEquals(db.inserted.length, 1);
});

Deno.test("createCheck still enforces MAX_CHECKS_PER_PROJECT when the interval is valid", async () => {
  const db = new FakeD1(MAX_CHECKS_PER_PROJECT);
  const result = await createCheck(
    db as unknown as D1Database,
    "project-1",
    makeInput(),
  );
  assertEquals(result, "limit-reached");
});
