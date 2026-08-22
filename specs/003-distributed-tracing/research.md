# Research: Distributed Tracing

Consolidates protocol research (Sentry's real distributed-tracing/performance-monitoring protocol,
researched against develop.sentry.dev) and Cloudflare-platform research (D1 percentile queries,
D1/Queues limits, storage tradeoffs) gathered before writing this module's spec/plan, plus the
scope decisions made from them. Written in the same decision/rationale/alternatives format as
Module 2's research.md (specs/002-error-monitoring/research.md).

## 1. Trace propagation headers

**Decision**: FlightDeck's ingest does not itself validate or re-derive `sentry-trace`/`baggage` —
that's SDK-to-SDK propagation, transparent to the server. The data model only needs to record what
already arrives consistently in the payload.

`sentry-trace` format: `<trace_id>-<span_id>-<sampled>` (`sampled` optional). `trace_id` is 128 bits
(32 hex chars), `span_id` is 64 bits (16 hex chars), `sampled` is `1`/`0`/omitted. An SDK making an
outgoing request injects the current span as parent for the next hop; a server SDK reads it from an
incoming request to continue the same trace as a child span — this is the actual mechanism that
makes a trace "distributed" across a JS-frontend-calls-Python-backend boundary (spec.md User Story
1's independent test requires exercising this, not just single-service tracing).

`baggage` (W3C Baggage format) carries Sentry's Dynamic Sampling Context (DSC) as `sentry`-prefixed
keys (`sentry-trace_id`, `sentry-public_key`, `sentry-sample_rate`, `sentry-sampled`,
`sentry-release`, `sentry-environment`, `sentry-transaction`, etc.) — fixed once at the trace root
and copied verbatim by every downstream service, which is what keeps a sampling decision consistent
across the whole trace.

**Source**: https://develop.sentry.dev/sdk/distributed-tracing/,
https://develop.sentry.dev/sdk/foundations/trace-propagation/dynamic-sampling-context.md

## 2. Transaction envelope item & data model

**Decision**: Extend the existing envelope endpoint and parser rather than building a second ingest
route. Item type is the literal string `"transaction"`, mutually exclusive with `"event"` within one
envelope (confirmed by Sentry's own docs) — `worker/modules/ingest/envelope.ts` needs a new
`isTransactionItem()` alongside its existing `isEventItem()`, and `worker/modules/ingest/routes.ts`
dispatches per item type after the unchanged DSN-auth/rate-limit steps.

Confirmed transaction payload fields: `type: "transaction"` (required), `start_timestamp`
(required), `timestamp` (required), `contexts.trace` (recommended — `trace_id`, `span_id`,
`parent_span_id`, `op`, `description`, `status`; this IS the transaction's own root span),
`spans[]` (recommended — nested INSIDE the transaction's own payload, never sent as separate
envelope items; each span carries `span_id`, `trace_id`, `parent_span_id`, `op`, `description`,
`start_timestamp`, `timestamp`, `status`, `tags`, `data`), `transaction_info` (transaction
name/annotation). No documented hard cap on spans-per-transaction was found in official docs —
FlightDeck reuses the existing `MAX_ENVELOPE_BYTES` payload-size guard (research could not justify
inventing a separate span-count limit as a protocol requirement).

Transactions have always been envelope-only since their introduction — no legacy `/store/`-equivalent
endpoint ever existed for them (unlike errors' pre-envelope history). Nothing to support there.

**Source**: https://develop.sentry.dev/sdk/data-model/envelope-items/,
https://develop.sentry.dev/sdk/data-model/event-payloads/transaction/

## 3. Trace-to-error linkage

**Decision**: Add a small, additive migration to the EXISTING `events` table (not a new table) — a
nullable, indexed `trace_id` column (and `span_id`, same treatment). Extraction happens in the
existing, unchanged, synchronous error-ingest code path: when an event's `contexts.trace.trace_id`
is present, store it alongside the event row. No backfill for pre-existing rows.

**Rationale**: `contexts.trace` is the SAME context object used on both transaction events and
regular error events — Sentry's docs note it's "recommended for linking events to traces even
without performance monitoring." Without an indexed column, "which errors happened during this
trace" would require scanning and JSON-parsing every event row, which doesn't scale and contradicts
the indexed-lookup pattern already established for the `transactions` table (§6). This is the
concrete mechanism behind the constitution's stated "shared identifiers... so an alert, a log line,
and a stack frame are always one click apart" goal (spec.md User Story 3).

**Source**: https://develop.sentry.dev/sdk/foundations/data-model/event-payloads/contexts

## 4. Ingest write path: Cloudflare Queues (adopted now, unlike Module 2's deferral)

**Decision**: Trace ingestion pushes parsed transaction payloads onto a new Queue binding
(`TRACE_INGEST`) and returns `200` immediately — no synchronous D1 write in the request path. A new
`queue(batch, env, ctx)` handler, exported alongside `worker/index.ts`'s existing `fetch`/
`scheduled`, batches incoming messages and writes them to D1 via `db.batch()`. Module 2's
error/event path is explicitly UNCHANGED — this only applies to the new transaction path.

**Rationale**: Module 2 deferred Queues for errors, reasoning D1's single-writer semantics only
become a bottleneck "well above what an early-stage product needs" (tens of events/sec). Traces
change that calculus structurally, not just by degree: one user session produces many transactions,
and — before this module's storage decision (§6) — could naively produce one row per span (100+
writes per single transaction). Against D1's free-tier ceiling of 100,000 row-writes/day with no
overage (a hard block, not a soft limit), that risk is concrete enough to act on now rather than
defer again. This was confirmed as the deliberate scope decision (not a default) during this
module's scoping discussion.

**Design**:
- Queue config (`wrangler.jsonc`): producer binding `TRACE_INGEST`; consumer settings
  `max_batch_size: 50` (under Cloudflare's 100-message consumer batch cap), `max_batch_timeout: 5`
  (seconds — bounds worst-case ingest-to-visible latency), `max_retries: 3`, `dead_letter_queue:
  "trace-ingest-dlq"` (a second queue, not silently dropped messages).
- Consumer behavior: Cloudflare Queues acks/retries **per message within a batch** when the handler
  calls `message.retry()`/`message.ack()` individually (rather than only a whole-batch
  success/failure) — the consumer MUST process each message independently (e.g. wrap each
  transaction's D1 write in its own try/catch, ack on success, retry on failure) so one malformed
  transaction in a batch doesn't block or roll back the other 49.
- Documented limits this design respects: 5,000 messages/sec per queue, 128 KB max message size
  (a serialized transaction payload — reuses envelope's `MAX_ENVELOPE_BYTES` reasoning, but the
  plan should verify a realistic large transaction fits under 128 KB, not just under
  `MAX_ENVELOPE_BYTES`), `sendBatch()` up to 100 messages/256 KB (not used here — one `send()` per
  ingested transaction, since transactions arrive independently over HTTP, not pre-batched),
  consumer batch max 100 messages, dead-letter retention up to 14 days.

**Verification item, spike-style (T010) — CONFIRMED during implementation, not left open**: whether
Cloudflare Queues' local emulation under `wrangler dev` reliably delivers producer→consumer
end-to-end. Verified live: started `wrangler dev --env preview`, POSTed a hand-crafted `"transaction"`
envelope item to `/api/demo/envelope`, and confirmed the resulting row landed in the local
`transactions` table with correct `duration_ms`/`trace_id`/`name`/`op` — no manual queue-flush step,
no fallback needed. Also verified, in the same live session: the p50/p95 percentile query
(single-transaction case, `computeOffset`'s edge case), the `GET /api/internal/traces/{id}` detail
response's span mapping, the new `by-trace-id` resolution endpoint, and BOTH directions of the
trace-to-error linkage (an error ingested with a matching `contexts.trace.trace_id` correctly showed
up in the transaction's `linkedErrors`, and the issue's own detail response correctly showed the
resolved `traceId`). The documented fallback (test the producer and the consumer's write logic
separately) was therefore not needed — the contract test suite polls against real end-to-end local
delivery, per the primary design below, not the fallback.

**Source**: https://developers.cloudflare.com/queues/platform/limits/,
https://developers.cloudflare.com/queues/,
https://developers.cloudflare.com/d1/platform/pricing/ (100k row-writes/day free tier),
https://blog.cloudflare.com/d1-turning-it-up-to-11/ (`db.batch()` throughput)

## 5. D1 limits relevant to trace ingestion

From https://developers.cloudflare.com/d1/platform/limits/: max row/BLOB size 2,000,000 bytes
(2 MB); max SQL statement length 100,000 bytes; max query duration 30s; max bound parameters per
query 100; max queries per Worker invocation 1000 (Paid) / 50 (Free); max database size 10 GB
(Paid) / 500 MB (Free). From https://developers.cloudflare.com/d1/platform/pricing/: free tier
100,000 row-writes/day, 5M row-reads/day; paid tier 50M row-writes/month included then $1.00/million
rows.

**Relevance**: the 100-bound-parameters-per-query ceiling directly rules out one `INSERT` per span
for a 100+-span transaction as a single statement regardless of storage shape (§6 avoids this by
storing the span tree as one blob, not one row per span). `db.batch()` sends multiple statements in
one round trip, executed sequentially as one transaction, with Cloudflare's own benchmark reporting
roughly 10-11x throughput versus unbatched calls for a comparable write shape — this is what the
queue consumer (§4) relies on for batch writes.

**Source**: https://developers.cloudflare.com/d1/worker-api/d1-database/,
https://blog.cloudflare.com/d1-turning-it-up-to-11/

## 6. Storage shape: transactions table + inline span-tree blob (not R2)

**Decision**: One `transactions` row per ingested transaction — indexed `project_id`, `trace_id`,
`name`, `op`, `duration_ms` (computed at write time, in the queue consumer, from
`timestamp - start_timestamp`; never recomputed at read time), `started_at`. The full `spans[]` tree
is stored as one `TEXT` (JSON) column on that same row — matching Module 2's `events.payload`
pattern, NOT R2.

**Rationale — actually reasoned through size, not assumed by analogy** (per this module's own
scoping requirement not to blindly reuse the events.payload precedent): a span carries `span_id`
(16 hex chars), `trace_id` (32 hex chars), `parent_span_id`, `op`, `description`, two timestamps,
`status`, and optional small `tags`/`data` objects — roughly 150-400 bytes per span depending on
how much `tags`/`data` a given SDK attaches. Even a transaction with 200 spans (well above what
either research pass found evidence of as a typical count) lands around 30-80 KB serialized —
nowhere near D1's 2 MB max row/BLOB size, and small enough that R2's GET-round-trip cost (justified
for Module 2's source maps, which are genuinely large build artifacts read rarely) isn't justified
here: span trees are read exactly once per trace-detail-view open, by the same request that also
needs the `transactions` summary row, so keeping them in the same D1 row avoids a second network
hop for what's actually a small, frequently-co-read payload — closer to Module 2's events.payload
tradeoff (small, read together with its summary) than its source-maps tradeoff (large, read rarely,
alone). Revisit only if real-world span-tree sizes prove this estimate wrong.

**Indexes**: `(project_id, name, started_at)` for the percentile query (§7) and transaction list;
`(trace_id)` for the trace-to-error linkage lookup and direct trace-detail fetch.

## 7. Percentile computation: on-demand query-time, no pre-aggregation

**Decision**: p50/p95 computed at query time per `(project_id, name)` grouping, over a bounded
24-hour window, using the portable SQLite pattern:

```sql
SELECT duration_ms FROM transactions
WHERE project_id = ?1 AND name = ?2 AND started_at > ?3
ORDER BY duration_ms ASC
LIMIT 1 OFFSET MAX(0,
  (SELECT CAST(COUNT(*) * 0.95 AS INTEGER) - 1 FROM transactions
   WHERE project_id = ?1 AND name = ?2 AND started_at > ?3)
);
```

(swap `0.95` for `0.50` for p50). This runs once per transaction-name group shown in the Traces
list — for a project with N distinct operation names, that's up to 2N queries (p50 + p95 each) per
list-view load, not one global aggregate query.

**Rationale**: SQLite has no native `PERCENTILE_CONT`/`PERCENTILE_DISC`. Window functions
(`NTILE`, `PERCENT_RANK`) that could compute grouped percentiles in one pass exist in standard
SQLite since 3.25, and D1 likely runs a version that supports them, but no Cloudflare-authored page
confirms window-function support in D1 specifically — the D1 SQL statements page documents
extensions (FTS5, JSON, math functions) and PRAGMAs without listing window functions either way.
Depending on unconfirmed behavior for this module's core aggregation feature is exactly the kind of
risk Module 2's T027 spike existed to avoid for source maps. **Decision therefore treats the
`ORDER BY`/`OFFSET` per-group approach as the MVP baseline**, not the window-function form — tasks.md
should still include a cheap, non-blocking spike to verify window-function support in a live
`wrangler dev`, but as a future-optimization confirmation, not a gate blocking this module's
implementation the way T027 gated Module 2's source-map work (the fallback here already works and
is simple, unlike source-map resolution which had no simple fallback).

The 24-hour window is a deliberate default (not left implicit, per this module's scoping
requirement) — recent-enough to reflect current behavior, bounded enough to keep the `ORDER BY`
scan cheap regardless of total retained history.

**Source**: https://developers.cloudflare.com/d1/sql-api/sql-statements/,
https://sqlite.org/windowfunctions.html

## 8. Retention: transactions get their own (shorter) window

**Decision**: `transactions` rows (and their inline span-tree blobs) are pruned after **30 days**,
distinct from Module 2's 90-day `events` retention — extending the existing `worker/modules/ingest/
retention.ts` (already wired into `worker/index.ts`'s `scheduled()` handler) to also delete
`transactions` rows past this window on the same cron trigger.

**Rationale**: trace volume is structurally higher per user session than error volume (many
transactions per session vs. one error per actual bug) — against D1's free-tier 100k-writes/day and
500MB-storage ceilings (§5), inheriting Module 2's 90-day number unexamined would be optimistic
rather than a considered default, which constitution Principle IX explicitly requires ("retention
windows... MUST default to a bounded, documented period" — bounded AND appropriately sized, not
just "some number"). 30 days is picked as a concrete, justified starting point (a month of recent
performance history covers the "is this operation still slow" question the feature exists to
answer) rather than left as an unexamined inheritance from Module 2.

**Unlike Module 2's issues/events split, a `transactions` row is itself the summary** — there's no
separate aggregate row to preserve the way an `issue` row survives its `events` being pruned.
Pruning past the window means the row (summary fields AND span-tree blob) is fully deleted; the
Traces list and percentile queries simply reflect whatever remains, exactly as spec.md's Edge Cases
section states. No partial-preservation scheme applies here, and inventing one would contradict the
actual data shape.

## 9. Testing approach for the async, queue-based ingest path

**Decision**: the queue-based trace ingest path is genuinely different from Module 2's synchronous
error path and needs a different contract-test shape — a test that POSTs a transaction envelope
then immediately queries `GET /api/internal/traces` will race the queue consumer. The contract test
suite polls (bounded retries with a short backoff, e.g. up to 5 attempts / a few seconds total, not
an unbounded wait) until the transaction becomes queryable, rather than asserting immediately after
the `200` response — this is a real, load-bearing difference from Module 2's tests, not an
oversight to fix later.

Pure-function logic (span depth/position calculation for the waterfall, percentile SQL construction,
transaction-envelope-item dispatch, `duration_ms` computation) stays unit-testable without bindings,
same rigor as Module 2's fingerprinting/envelope/DSN-auth unit tests.

## 10. Frontend: waterfall UI and app-shell navigation

**Decision**: a real visual timeline — horizontal bars per span, positioned along a shared time axis
by `start_timestamp` relative to the transaction's own start, sized proportionally to duration,
indented by `parent_span_id`-derived depth (not a plain indented text list, per the explicit scoping
decision to invest more frontend effort here than Module 2's stack-trace list view, since a visual
waterfall is what makes this module recognizably an APM feature).

App-shell navigation reuses Module 2's research.md §11 reasoning unchanged: component-state-based
screen switching (a new `selectedTraceId` alongside `AppShell.tsx`'s existing `selectedIssueId`,
routing to a new `"trace-detail"` screen case) — nothing about this module's scope (no deep-linking
requirement in spec.md) justifies introducing URL routing where Module 2 deliberately didn't.

**Alternatives considered**: a canvas-based flamegraph renderer (rejected as unnecessary complexity
for this module's scope — CSS-positioned `div`s at computed left/width percentages render a
waterfall correctly for the realistic span counts this module expects, per §6's size reasoning,
without needing canvas/SVG-level rendering machinery).

## 11. Sampling: trust-the-client, no server-side re-sampling

**Decision**: `tracesSampleRate` and sampling decisions are entirely client-side (SDK) concerns.
FlightDeck stores whatever `sampled`/trace data arrives via envelope — no server-side re-sampling,
rejection based on the `sampled` flag, or dynamic-sampling-configuration UI (that's a real Sentry
Business-tier feature, explicitly out of scope per spec.md's Assumptions).

**Source**: https://develop.sentry.dev/sdk/foundations/trace-propagation/#propagation-decision-matrix
