import { assertEquals } from "@std/assert";
import { computeDepths, layoutWaterfall } from "../../worker/modules/ingest/waterfall-layout.ts";
import type { RawSpan } from "../../worker/modules/ingest/waterfall-layout.ts";

const ROOT_SPAN = "root0000";

function span(overrides: Partial<RawSpan> & { span_id: string }): RawSpan {
  return {
    parent_span_id: null,
    op: "op",
    description: null,
    start_timestamp: 0,
    timestamp: 1,
    status: "ok",
    ...overrides,
  };
}

Deno.test("computeDepths derives depth from parent_span_id chains", () => {
  const spans = [
    span({ span_id: "a", parent_span_id: ROOT_SPAN }),
    span({ span_id: "b", parent_span_id: "a" }),
    span({ span_id: "c", parent_span_id: "b" }),
  ];
  const depths = computeDepths(spans);
  assertEquals(depths.get("a"), 1);
  assertEquals(depths.get("b"), 2);
  assertEquals(depths.get("c"), 3);
});

Deno.test("a span with a dangling parent_span_id is treated as a direct child of the root, not dropped", () => {
  const spans = [
    span({ span_id: "a", parent_span_id: "does-not-exist" }),
  ];
  const depths = computeDepths(spans);
  assertEquals(depths.get("a"), 1);
});

Deno.test("layoutWaterfall computes position/width proportional to start_timestamp/duration", () => {
  const spans = [
    span({ span_id: "a", parent_span_id: ROOT_SPAN, start_timestamp: 0, timestamp: 5 }),
    span({ span_id: "b", parent_span_id: "a", start_timestamp: 5, timestamp: 10 }),
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
