import { assertEquals } from "@std/assert";
import { computeDepths, layoutWaterfall } from "../../worker/modules/ingest/waterfall-layout.ts";
import type { RawSpan } from "../../worker/modules/ingest/waterfall-layout.ts";

const ROOT_SPAN = "root0000";

// Fixture uses the same camelCase shape contracts/traces-internal-api.md documents for
// `GET /api/internal/traces/{id}`'s `spans` field (`spanId`/`parentSpanId`/`startTimestamp`) — the
// real shape TraceDetailScreen.tsx receives over the wire, not the snake_case shape spans_json is
// stored in (worker/modules/traces/routes.ts maps between the two). GitHub issue #79 was this
// suite testing a self-consistent but wrong (snake_case) fixture instead of this real shape.
function span(overrides: Partial<RawSpan> & { spanId: string }): RawSpan {
  return {
    parentSpanId: null,
    op: "op",
    description: null,
    startTimestamp: 0,
    timestamp: 1,
    status: "ok",
    ...overrides,
  };
}

Deno.test("computeDepths derives depth from parentSpanId chains", () => {
  const spans = [
    span({ spanId: "a", parentSpanId: ROOT_SPAN }),
    span({ spanId: "b", parentSpanId: "a" }),
    span({ spanId: "c", parentSpanId: "b" }),
  ];
  const depths = computeDepths(spans);
  assertEquals(depths.get("a"), 1);
  assertEquals(depths.get("b"), 2);
  assertEquals(depths.get("c"), 3);
});

Deno.test("a span with a dangling parentSpanId is treated as a direct child of the root, not dropped", () => {
  const spans = [
    span({ spanId: "a", parentSpanId: "does-not-exist" }),
  ];
  const depths = computeDepths(spans);
  assertEquals(depths.get("a"), 1);
});

Deno.test("layoutWaterfall computes position/width proportional to startTimestamp/duration", () => {
  const spans = [
    span({ spanId: "a", parentSpanId: ROOT_SPAN, startTimestamp: 0, timestamp: 5 }),
    span({ spanId: "b", parentSpanId: "a", startTimestamp: 5, timestamp: 10 }),
  ];
  const laidOut = layoutWaterfall(0, 10, spans);

  assertEquals(laidOut[0].leftPercent, 0);
  assertEquals(laidOut[0].widthPercent, 50);
  assertEquals(laidOut[0].depth, 1);

  assertEquals(laidOut[1].leftPercent, 50);
  assertEquals(laidOut[1].widthPercent, 50);
  assertEquals(laidOut[1].depth, 2);
});

Deno.test("layoutWaterfall handles a transaction with zero spans", () => {
  assertEquals(layoutWaterfall(0, 5, []), []);
});

Deno.test("layoutWaterfall never produces NaN positions for well-formed camelCase spans", () => {
  // Regression guard for GitHub issue #79: a field-name mismatch between this function's expected
  // shape and the real shape it's fed silently produces NaN left/width instead of throwing, so
  // this asserts the positive case explicitly rather than relying on absence of a thrown error.
  const spans = [
    span({ spanId: "a", parentSpanId: null, startTimestamp: 1, timestamp: 2 }),
  ];
  const laidOut = layoutWaterfall(1, 2, spans);
  assertEquals(Number.isNaN(laidOut[0].leftPercent), false);
  assertEquals(Number.isNaN(laidOut[0].widthPercent), false);
});
