// Pure waterfall layout computation — research.md §10 (specs/003-distributed-tracing). Imported
// directly by app/shell/TraceDetailScreen.tsx (client-side rendering geometry, never transmitted
// or stored) as well as unit-tested here without any Worker bindings.

export interface RawSpan {
  span_id: string;
  parent_span_id?: string | null;
  op?: string | null;
  description?: string | null;
  start_timestamp: number;
  timestamp: number;
  status?: string | null;
}

export interface LayoutSpan extends RawSpan {
  depth: number;
  leftPercent: number;
  widthPercent: number;
}

// A span's depth is derived from its parent_span_id chain. A span whose parent_span_id doesn't
// match any span_id among its own transaction's spans — e.g. an SDK-side span-count truncation —
// is treated as a direct child of the root (depth 1), per spec.md's Edge Cases, rather than
// dropped or erroring. A `seen` cycle guard defends against a pathological cyclic reference
// (not a documented protocol case, but cheap to guard against recursing forever on one).
export function computeDepths(spans: RawSpan[]): Map<string, number> {
  const bySpanId = new Map(spans.map((s) => [s.span_id, s]));
  const depthCache = new Map<string, number>();

  function depthOf(spanId: string, seen: Set<string>): number {
    const cached = depthCache.get(spanId);
    if (cached !== undefined) return cached;

    const span = bySpanId.get(spanId);
    const parentId = span?.parent_span_id;
    if (!span || !parentId || !bySpanId.has(parentId) || seen.has(spanId)) {
      depthCache.set(spanId, 1);
      return 1;
    }

    const depth = depthOf(parentId, new Set(seen).add(spanId)) + 1;
    depthCache.set(spanId, depth);
    return depth;
  }

  for (const span of spans) depthOf(span.span_id, new Set());
  return depthCache;
}

// Position/width are proportional to start_timestamp/duration on the transaction's own time axis
// — transactionStart/transactionEnd are the transaction's own root span bounds (epoch seconds),
// not derived from the spans themselves, so the root always occupies the full 0-100% width.
export function layoutWaterfall(
  transactionStart: number,
  transactionEnd: number,
  spans: RawSpan[],
): LayoutSpan[] {
  const depths = computeDepths(spans);
  const totalDuration = Math.max(transactionEnd - transactionStart, 1e-6);

  return spans.map((span) => {
    const left = Math.max(0, span.start_timestamp - transactionStart);
    const width = Math.max(0, span.timestamp - span.start_timestamp);
    return {
      ...span,
      depth: depths.get(span.span_id) ?? 1,
      leftPercent: (left / totalDuration) * 100,
      // Floored so a very fast span stays visible/clickable rather than collapsing to nothing.
      widthPercent: Math.max((width / totalDuration) * 100, 0.5),
    };
  });
}
