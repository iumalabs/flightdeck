// Trace-to-error linkage extraction — research.md §3 (specs/003-distributed-tracing).
// `contexts.trace` is the same context object Sentry attaches to both transaction and regular
// error events; this reads it off an error event to record which trace was active when the error
// was captured, without requiring a transaction to have been ingested at all.

export interface EventLike {
  contexts?: Record<string, unknown>;
}

export interface TraceContext {
  traceId: string;
  spanId: string | null;
}

export function extractTraceContext(event: EventLike): TraceContext | null {
  const trace = event.contexts?.trace as { trace_id?: unknown; span_id?: unknown } | undefined;
  if (!trace || typeof trace.trace_id !== "string" || trace.trace_id.length === 0) return null;
  return {
    traceId: trace.trace_id,
    spanId: typeof trace.span_id === "string" ? trace.span_id : null,
  };
}
