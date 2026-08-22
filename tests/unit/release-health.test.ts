import { assertEquals } from "@std/assert";
import {
  computeCrashFreeRate,
  extractSessionOutcomes,
  foldOutcomesIntoCounters,
  RELEASE_HEALTH_USERS_CAP,
  shouldTrackDistinctUser,
} from "../../worker/modules/ingest/release-health.ts";

Deno.test("extractSessionOutcomes parses a single 'session' item with its did", () => {
  const outcomes = extractSessionOutcomes("session", {
    did: "user-1",
    status: "crashed",
    started: "2026-08-22T10:00:00Z",
    attrs: { release: "1.0.0", environment: "production" },
  });
  assertEquals(outcomes, [
    {
      release: "1.0.0",
      environment: "production",
      date: "2026-08-22",
      status: "crashed",
      did: "user-1",
    },
  ]);
});

Deno.test("extractSessionOutcomes parses a 'sessions' aggregate batch, one outcome per count, did null", () => {
  const outcomes = extractSessionOutcomes("sessions", {
    attrs: { release: "1.0.0", environment: "production" },
    aggregates: [{ started: "2026-08-22T00:00:00Z", exited: 3, errored: 1, crashed: 1 }],
  });
  assertEquals(outcomes.length, 5);
  assertEquals(outcomes.filter((o) => o.status === "exited").length, 3);
  assertEquals(outcomes.filter((o) => o.status === "errored").length, 1);
  assertEquals(outcomes.filter((o) => o.status === "crashed").length, 1);
  assertEquals(outcomes.every((o) => o.did === null), true);
});

Deno.test("extractSessionOutcomes returns [] when release is missing (can't attribute health data)", () => {
  assertEquals(extractSessionOutcomes("session", { status: "exited" }), []);
  assertEquals(
    extractSessionOutcomes("sessions", { aggregates: [{ started: "x", exited: 1 }] }),
    [],
  );
});

Deno.test("foldOutcomesIntoCounters folds a known distribution into correct daily counters", () => {
  const outcomes = [
    {
      release: "1.0.0",
      environment: "production",
      date: "2026-08-22",
      status: "exited" as const,
      did: null,
    },
    {
      release: "1.0.0",
      environment: "production",
      date: "2026-08-22",
      status: "exited" as const,
      did: null,
    },
    {
      release: "1.0.0",
      environment: "production",
      date: "2026-08-22",
      status: "crashed" as const,
      did: null,
    },
    {
      release: "1.0.0",
      environment: "production",
      date: "2026-08-22",
      status: "errored" as const,
      did: null,
    },
    // A different environment must NOT be folded into the same bucket.
    {
      release: "1.0.0",
      environment: "staging",
      date: "2026-08-22",
      status: "exited" as const,
      did: null,
    },
  ];
  const buckets = foldOutcomesIntoCounters(outcomes);
  const prod = buckets.get("1.0.0|production|2026-08-22");
  assertEquals(prod, {
    release: "1.0.0",
    environment: "production",
    date: "2026-08-22",
    sessionsTotal: 4,
    sessionsCrashed: 1,
    sessionsErrored: 1,
  });
  assertEquals(buckets.get("1.0.0|staging|2026-08-22")?.sessionsTotal, 1);
});

Deno.test("computeCrashFreeRate against a known distribution matches the standard definition", () => {
  // 100 sessions, 5 crashed -> 95% crash-free.
  assertEquals(computeCrashFreeRate(100, 5), 95);
});

Deno.test("computeCrashFreeRate returns null (not 0) with no data yet, per spec FR-006", () => {
  assertEquals(computeCrashFreeRate(0, 0), null);
});

Deno.test("computeCrashFreeRate is 100 when nothing has crashed", () => {
  assertEquals(computeCrashFreeRate(10, 0), 100);
});

Deno.test("shouldTrackDistinctUser allows tracking below the cap", () => {
  assertEquals(shouldTrackDistinctUser(0), true);
  assertEquals(shouldTrackDistinctUser(RELEASE_HEALTH_USERS_CAP - 1), true);
});

Deno.test("shouldTrackDistinctUser skips tracking at and beyond the cap", () => {
  assertEquals(shouldTrackDistinctUser(RELEASE_HEALTH_USERS_CAP), false);
  assertEquals(shouldTrackDistinctUser(RELEASE_HEALTH_USERS_CAP + 1), false);
});
