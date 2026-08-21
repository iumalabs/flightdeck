# Phase 1 Data Model: Distributed Tracing

## Event (extends Module 2's entity — additive columns only)

| Field | Type | Notes |
|---|---|---|
| `trace_id` | TEXT, NULLABLE | New column. Extracted from an ingested error event's `contexts.trace.trace_id` at ingest time (research.md §3), when present. Indexed. |
| `span_id` | TEXT, NULLABLE | New column. Extracted from `contexts.trace.span_id` alongside `trace_id`, when present. |

**Validation rules**: both nullable, no backfill for pre-existing rows (defaults to `NULL`) — an
error event captured with no active trace simply has `trace_id IS NULL`, which is the expected,
non-error state per spec.md's Edge Cases and FR-009.

**Index**: `CREATE INDEX idx_events_trace_id ON events (trace_id)` — supports the trace-detail
view's "which errors happened during this trace" lookup (`WHERE trace_id = ?`) without a full-table
scan.

## Transaction

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY | Server-generated. |
| `project_id` | TEXT, NOT NULL, REFERENCES projects(id) | |
| `trace_id` | TEXT, NOT NULL | The transaction's own `contexts.trace.trace_id` — this transaction IS the root span of this trace. |
| `sdk_event_id` | TEXT, NOT NULL | The SDK's own `event_id` from the envelope header — used for de-duplication, same pattern as Module 2's `events.sdk_event_id`. |
| `name` | TEXT, NOT NULL | From `transaction_info` (or the envelope's `transaction` field, per SDK version) — what the Traces list groups by. |
| `op` | TEXT | From `contexts.trace.op` — nullable, some SDKs may omit it. |
| `duration_ms` | INTEGER, NOT NULL | Computed once, in the queue consumer, from `timestamp - start_timestamp` (research.md §6) — never recomputed at read time. |
| `started_at` | TEXT, NOT NULL | From `start_timestamp`, normalized to the same `datetime('now')`-comparable text format Module 2's tables use. |
| `spans_json` | TEXT, NOT NULL | The full `spans[]` array as ingested, JSON-serialized. Size-reasoned (not R2) per research.md §6. |
| `received_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | What the retention job (research.md §8) prunes against — distinct from `started_at` (client-reported) so retention isn't affected by client clock skew. |

**Validation rules**: `UNIQUE(project_id, sdk_event_id)` — a duplicate submission (queue redelivery
after a retry, or a genuine client retry) is an upsert-no-op, mirroring Module 2's event dedup
(spec FR-006) exactly, including under Cloudflare Queues' at-least-once delivery semantics — the
same uniqueness constraint that protects against a client-side retry also protects against a
queue-level redelivery, so no separate idempotency mechanism is needed for the queue path.

**Indexes**: `(project_id, name, started_at)` for the percentile query and transaction list
(research.md §7); `(trace_id)` for the trace-detail direct fetch and the reverse
trace-to-error-lookup's counterpart.

**State transitions**: insert only, from the queue consumer. Deleted by the retention job once
`received_at` exceeds the default window (30 days, research.md §8) — full row deletion, no
partial-preservation scheme (unlike Module 2's issue/event split, a `transactions` row has no
separate summary row to preserve; it IS the summary).

## Span (embedded, not a standalone table)

Spans are NOT a separate D1 table/rows — they live entirely inside a `Transaction`'s `spans_json`
column, matching how Sentry's own protocol nests them inside one transaction payload (research.md
§2), not as independent envelope items.

| Field (within each array element) | Type | Notes |
|---|---|---|
| `span_id` | string | 16 hex chars. |
| `parent_span_id` | string, nullable | Null/absent for a span whose direct parent is the transaction's own root span. Used to compute waterfall nesting depth (research.md §10). |
| `op` | string | |
| `description` | string, nullable | |
| `start_timestamp` | number | Used with `timestamp` to compute this span's position/width on the waterfall's shared time axis. |
| `timestamp` | number | |
| `status` | string, nullable | |
| `tags` / `data` | object, nullable | Stored as-ingested, not individually validated. |

**Validation rules**: a span whose `parent_span_id` doesn't match any span in the same transaction
(a dangling reference — e.g. from an SDK-side span-count truncation) is rendered as if it were a
direct child of the transaction's root, per spec.md's Edge Cases — the waterfall view MUST NOT fail
to render the rest of the transaction over one inconsistent span.

## Cross-entity relationship: trace-to-error linkage

A `trace_id` value MAY appear on exactly one `Transaction` row (the trace's root) and on zero or
more `Event` rows (errors captured during that trace). This is not a foreign-key relationship in
either direction (an `Event.trace_id` may reference a trace for which no `Transaction` was ever
ingested — e.g. tracing disabled but `contexts.trace` still attached per research.md §3's citation
of Sentry's own "recommended... even without performance monitoring" guidance — and a `Transaction`
may exist with no linked `Event` at all, the common case). Both directions are looked up by matching
`trace_id` values at read time (`worker/modules/traces/routes.ts` and the extended
`worker/modules/issues/routes.ts`), not enforced or denormalized further.
