import { assertEquals, assertMatch } from "@std/assert";
import { runCheck } from "../../worker/modules/uptime/evaluate.ts";

// constitution Principle V's proof-by-construction (specs/006-uptime-monitoring research.md §8):
// this module's ENTIRE case for compliance rests on both the scheduled cron path
// (worker/index.ts's runDueUptimeChecks) and the interactive trigger route
// (worker/modules/uptime/routes.ts's POST /checks/:id/trigger) calling this exact `runCheck`
// export — not two separately-implemented paths that merely behave similarly.

// Part 1 — static proof: both call sites import `runCheck` from the SAME resolved module path
// (ES module semantics guarantee identical importers of the same specifier share the identical
// function object — there is no way for two distinct `runCheck` implementations to both satisfy
// this), and each calls it directly rather than through a same-named local wrapper.
Deno.test("worker/index.ts's scheduled uptime case imports and calls the shared runCheck", async () => {
  const source = await Deno.readTextFile(
    new URL("../../worker/index.ts", import.meta.url),
  );
  assertMatch(source, /import\s*{\s*runCheck\s*}\s*from\s*"\.\/modules\/uptime\/evaluate\.ts"/);
  assertMatch(source, /await runCheck\(env, row\.id, "scheduled"\)/);
});

Deno.test("worker/modules/uptime/routes.ts's trigger route imports and calls the shared runCheck", async () => {
  const source = await Deno.readTextFile(
    new URL("../../worker/modules/uptime/routes.ts", import.meta.url),
  );
  assertMatch(source, /import\s*{\s*runCheck\s*}\s*from\s*"\.\/evaluate\.ts"/);
  assertMatch(source, /await runCheck\(c\.env, id, "interactive"\)/);
});

// Part 2 — behavioral proof: calling the shared export directly with the two different trigger
// values, against identical starting state, produces identical resulting state (status,
// consecutive counters, incident transitions) — the ONLY permitted difference is the `trigger`
// label recorded on the check_runs row, never a difference in pass/fail evaluation or threshold
// logic (research.md §8).

interface FakeCheckRow {
  id: string;
  name: string;
  type: string;
  target: string;
  failure_threshold: number;
  recovery_threshold: number;
  webhook_url: string | null;
  consecutive_failures: number;
  consecutive_successes: number;
  status: string;
}

interface FakeIncidentRow {
  id: string;
  check_id: string;
  resolved_at: string | null;
}

class FakeD1 {
  checks = new Map<string, FakeCheckRow>();
  incidents: FakeIncidentRow[] = [];
  checkRuns: { checkId: string; trigger: string; succeeded: number }[] = [];

  seed(check: FakeCheckRow) {
    this.checks.set(check.id, { ...check });
  }

  prepare = (sql: string) => {
    return {
      bind: (...args: unknown[]) => {
        return {
          first: <T>(): Promise<T | null> => {
            if (sql.includes("SELECT id, name, type, target, failure_threshold")) {
              const row = this.checks.get(args[0] as string);
              return Promise.resolve((row ?? null) as T | null);
            }
            if (sql.startsWith("UPDATE checks SET")) {
              const [id, succeededFlag] = args as [string, number];
              const row = this.checks.get(id)!;
              if (succeededFlag === 1) {
                row.consecutive_successes += 1;
                row.consecutive_failures = 0;
                row.status = "up";
              } else {
                row.consecutive_failures += 1;
                row.consecutive_successes = 0;
                row.status = "down";
              }
              return Promise.resolve({
                consecutive_failures: row.consecutive_failures,
                consecutive_successes: row.consecutive_successes,
              } as T);
            }
            if (sql.includes("SELECT id FROM incidents")) {
              const checkId = args[0] as string;
              const open = this.incidents.find((i) =>
                i.check_id === checkId && i.resolved_at === null
              );
              return Promise.resolve((open ? { id: open.id } : null) as T | null);
            }
            return Promise.resolve(null);
          },
          run: () => {
            if (sql.startsWith("INSERT INTO check_runs")) {
              const [, checkId, trigger, succeeded] = args as [string, string, string, number];
              this.checkRuns.push({ checkId, trigger, succeeded });
              return Promise.resolve({ meta: { changes: 1 } });
            }
            if (sql.startsWith("INSERT INTO incidents")) {
              const [id, checkId] = args as [string, string];
              const alreadyOpen = this.incidents.some(
                (i) => i.check_id === checkId && i.resolved_at === null,
              );
              if (alreadyOpen) return Promise.resolve({ meta: { changes: 0 } });
              this.incidents.push({ id, check_id: checkId, resolved_at: null });
              return Promise.resolve({ meta: { changes: 1 } });
            }
            if (sql.startsWith("UPDATE incidents SET resolved_at")) {
              const [checkId] = args as [string];
              const open = this.incidents.find(
                (i) => i.check_id === checkId && i.resolved_at === null,
              );
              if (!open) return Promise.resolve({ meta: { changes: 0 } });
              open.resolved_at = "now";
              return Promise.resolve({ meta: { changes: 1 } });
            }
            return Promise.resolve({ meta: { changes: 0 } });
          },
        };
      },
    };
  };
}

function withMockedFetch<T>(status: number, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("", { status }));
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function seedCheck(db: FakeD1, overrides: Partial<FakeCheckRow> = {}) {
  db.seed({
    id: "check-1",
    name: "demo",
    type: "http",
    target: "https://example.com",
    failure_threshold: 3,
    recovery_threshold: 2,
    webhook_url: null,
    consecutive_failures: 0,
    consecutive_successes: 0,
    status: "unknown",
    ...overrides,
  });
}

Deno.test("identical starting state + trigger value only differs -> identical resulting status/counters", async () => {
  const scheduledDb = new FakeD1();
  seedCheck(scheduledDb, { consecutive_failures: 2 });
  const interactiveDb = new FakeD1();
  seedCheck(interactiveDb, { consecutive_failures: 2 });

  const scheduledResult = await withMockedFetch(
    500,
    () => runCheck({ DB: scheduledDb as unknown as D1Database }, "check-1", "scheduled"),
  );
  const interactiveResult = await withMockedFetch(
    500,
    () => runCheck({ DB: interactiveDb as unknown as D1Database }, "check-1", "interactive"),
  );

  assertEquals(scheduledResult?.status, interactiveResult?.status);
  assertEquals(scheduledResult?.succeeded, interactiveResult?.succeeded);
  assertEquals(scheduledResult?.incidentOpened, interactiveResult?.incidentOpened);
  assertEquals(scheduledResult?.incidentOpened, true);
  assertEquals(scheduledDb.checks.get("check-1")?.consecutive_failures, 3);
  assertEquals(interactiveDb.checks.get("check-1")?.consecutive_failures, 3);
  // The only permitted difference: the trigger label recorded for attribution.
  assertEquals(scheduledDb.checkRuns[0].trigger, "scheduled");
  assertEquals(interactiveDb.checkRuns[0].trigger, "interactive");
});

Deno.test("reaching the failure threshold opens exactly one incident, not one per failed run", async () => {
  const db = new FakeD1();
  seedCheck(db, { failure_threshold: 2 });

  const first = await withMockedFetch(
    500,
    () => runCheck({ DB: db as unknown as D1Database }, "check-1", "scheduled"),
  );
  assertEquals(first?.incidentOpened, false);
  const second = await withMockedFetch(
    500,
    () => runCheck({ DB: db as unknown as D1Database }, "check-1", "scheduled"),
  );
  assertEquals(second?.incidentOpened, true);
  const third = await withMockedFetch(
    500,
    () => runCheck({ DB: db as unknown as D1Database }, "check-1", "scheduled"),
  );
  assertEquals(third?.incidentOpened, false);
  assertEquals(db.incidents.length, 1);
});

Deno.test("reaching the recovery threshold resolves the open incident", async () => {
  const db = new FakeD1();
  seedCheck(db, { failure_threshold: 1, recovery_threshold: 2, consecutive_failures: 0 });

  await withMockedFetch(
    500,
    () => runCheck({ DB: db as unknown as D1Database }, "check-1", "scheduled"),
  );
  assertEquals(db.incidents.length, 1);
  assertEquals(db.incidents[0].resolved_at, null);

  await withMockedFetch(
    200,
    () => runCheck({ DB: db as unknown as D1Database }, "check-1", "scheduled"),
  );
  assertEquals(db.incidents[0].resolved_at, null); // one success, threshold is 2 — not yet
  const resolved = await withMockedFetch(
    200,
    () => runCheck({ DB: db as unknown as D1Database }, "check-1", "scheduled"),
  );
  assertEquals(resolved?.incidentResolved, true);
  assertEquals(db.incidents[0].resolved_at, "now");
});
