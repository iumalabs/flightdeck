import { assertEquals } from "@std/assert";
import { extractTraceContext } from "../../worker/modules/ingest/trace-context.ts";

Deno.test("extractTraceContext returns traceId/spanId when contexts.trace.trace_id is present", () => {
  const event = { contexts: { trace: { trace_id: "abc123", span_id: "def456" } } };
  assertEquals(extractTraceContext(event), { traceId: "abc123", spanId: "def456" });
});

Deno.test("extractTraceContext returns null when contexts.trace is absent", () => {
  assertEquals(extractTraceContext({}), null);
  assertEquals(extractTraceContext({ contexts: {} }), null);
});

Deno.test("extractTraceContext returns null when trace_id is missing", () => {
  const event = { contexts: { trace: { span_id: "def456" } } };
  assertEquals(extractTraceContext(event), null);
});

Deno.test("extractTraceContext returns spanId null when span_id is absent", () => {
  const event = { contexts: { trace: { trace_id: "abc123" } } };
  assertEquals(extractTraceContext(event), { traceId: "abc123", spanId: null });
});
