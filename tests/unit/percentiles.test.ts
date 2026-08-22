import { assertEquals } from "@std/assert";
import { computeOffset } from "../../worker/modules/ingest/percentiles.ts";

Deno.test("computeOffset for a known distribution matches the expected p50/p95 index", () => {
  // 5 transactions -> p50 offset = floor(5*0.5)-1 = 1 (2nd cheapest), p95 offset = floor(5*0.95)-1 = 3
  assertEquals(computeOffset(5, 0.50), 1);
  assertEquals(computeOffset(5, 0.95), 3);
});

Deno.test("computeOffset for a single-transaction operation always returns 0", () => {
  assertEquals(computeOffset(1, 0.50), 0);
  assertEquals(computeOffset(1, 0.95), 0);
});

Deno.test("computeOffset for an even-count distribution", () => {
  // 4 transactions -> p50 offset = floor(4*0.5)-1 = 1, p95 offset = floor(4*0.95)-1 = 2
  assertEquals(computeOffset(4, 0.50), 1);
  assertEquals(computeOffset(4, 0.95), 2);
});

Deno.test("computeOffset never goes negative for a tiny count/percentile combination", () => {
  assertEquals(computeOffset(0, 0.50), 0);
});
