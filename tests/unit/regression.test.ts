import { assertEquals } from "@std/assert";
import { isRegression } from "../../worker/modules/ingest/regression.ts";
import type { ReleaseOrdering } from "../../worker/modules/ingest/regression.ts";

function release(id: string, createdAt: string): ReleaseOrdering {
  return { id, createdAt };
}

const r1 = release("r1", "2026-08-01 00:00:00");
const r2 = release("r2", "2026-08-02 00:00:00");
const r3 = release("r3", "2026-08-03 00:00:00");

Deno.test("exact mode: a later release triggers reopening", () => {
  assertEquals(isRegression("exact", r1, null, r2), true);
});

Deno.test("exact mode: the same release does NOT trigger reopening", () => {
  assertEquals(isRegression("exact", r1, null, r1), false);
});

Deno.test("exact mode: an earlier release does NOT trigger reopening", () => {
  // r2 resolved, but a new event is tagged with r1 (earlier) — not a regression.
  assertEquals(isRegression("exact", r2, null, r1), false);
});

Deno.test("next-release mode: the resolution-time next release triggers reopening", () => {
  // Resolved at r1, r2 was the next release created after resolution.
  assertEquals(isRegression("next-release", r1, r2, r2), true);
});

Deno.test("next-release mode: a release even later than the next one still triggers reopening", () => {
  assertEquals(isRegression("next-release", r1, r2, r3), true);
});

Deno.test("next-release mode: the originally-resolved release itself does NOT trigger reopening", () => {
  assertEquals(isRegression("next-release", r1, r2, r1), false);
});

Deno.test("next-release mode: no next release exists yet — never a regression (spec.md Edge Cases)", () => {
  assertEquals(isRegression("next-release", r1, null, r2), false);
});

Deno.test("next-release mode uses the resolution-time latest release as its basis, not a release created before resolution", () => {
  // Even though r3 exists, the comparison basis passed in is r2 (correctly resolved by the
  // caller as "whichever release was created immediately after the resolution") — isRegression
  // itself must not silently substitute a different basis.
  assertEquals(isRegression("next-release", r1, r2, r2), true);
  assertEquals(isRegression("next-release", r1, r2, r1), false);
});
