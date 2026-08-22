# Phase 1 Data Model: Structured Logs

## Log Batch

| Field            | Type                                      | Notes                                                                                                                                                                          |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`             | TEXT, PRIMARY KEY                         | Server-generated.                                                                                                                                                              |
| `project_id`     | TEXT, NOT NULL, REFERENCES projects(id)   |                                                                                                                                                                                |
| `r2_object_key`  | TEXT, NOT NULL                            | The NDJSON object's key in that project's dedicated R2 bucket (research.md §8) — `{project_id}/{yyyy}/{mm}/{dd}/{hh}/{batch-id}.ndjson`.                                       |
| `started_at`     | TEXT, NOT NULL                            | Min `timestamp` across the batch's log records.                                                                                                                                |
| `ended_at`       | TEXT, NOT NULL                            | Max `timestamp` across the batch's log records.                                                                                                                                |
| `record_count`   | INTEGER, NOT NULL                         | How many log lines this batch's NDJSON object contains.                                                                                                                        |
| `levels_present` | TEXT, NOT NULL                            | Comma-joined set of distinct `level` values in this batch — coarse pre-filter before any per-line extraction (research.md §5).                                                 |
| `received_at`    | TEXT, NOT NULL, DEFAULT `datetime('now')` | What the retention job (research.md §9) prunes against — distinct from `started_at`/`ended_at` (client-reported) for the same reason Module 3's `transactions.received_at` is. |

**Validation rules**: one row per R2 object the queue consumer writes — NEVER one row per log line
(research.md §4's central architectural decision). No uniqueness constraint on individual log lines
within a batch is enforced at the D1 level; de-duplication of a retried envelope submission (spec
FR-009) is handled by the queue consumer recognizing an already-processed envelope's identifier
before writing a new batch, not by a D1 constraint (the batch itself is the unit of writing, not the
individual line).

**Indexes**: `(project_id, started_at)` — powers both the search endpoint's time-range filtering and
the retention job's window scan.

## Log Batch (FTS5 virtual table)

`log_batches_fts` — a D1 FTS5 virtual table:

| Field         | Type                | Notes                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_text` | TEXT (FTS5-indexed) | The concatenation of every record's `body` plus its string-typed `attributes` values within that batch — written once, at the same time as the corresponding `log_batches` row, by the queue consumer.                                                                                      |
| `batch_id`    | TEXT (UNINDEXED)    | `log_batches.id`, stored directly rather than relied on via FTS5's implicit integer rowid — corrected during implementation, since `log_batches.id` is a UUID (TEXT), like every other table's primary key in this project, not an integer FTS5's own rowid could transparently align with. |

**Validation rules**: exists only to be queried via FTS5's `MATCH` syntax with BM25 ranking
(research.md §5) — never queried or joined on for anything other than full-text search. A search
result's `batch_id` resolves back to `log_batches` for the batch's metadata (`r2_object_key`, etc.),
which is then used to fetch and filter the actual matching lines at read time.

## Log Batch Trace (junction table)

| Field      | Type                                       | Notes                                                                                                                                                                                            |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `batch_id` | TEXT, NOT NULL, REFERENCES log_batches(id) |                                                                                                                                                                                                  |
| `trace_id` | TEXT, NOT NULL                             | One of possibly several distinct trace_ids present in this batch's log lines (every log record carries a required `trace_id` per research.md §1 — unlike Module 3's nullable `events.trace_id`). |

**Validation rules**: `UNIQUE(batch_id, trace_id)` — one row per distinct trace_id per batch, not
per log line, even if a given batch contains many log lines sharing the same trace_id.

**Indexes**: `(trace_id)` — the query Module 3's trace detail view uses to find "which log batches
contain lines from this trace," before extracting the actual matching lines from each candidate
batch's R2 object at read time (same read-time-extraction pattern as search, research.md §5-6).

## Export Credential (represents R2 API token state, not a new D1 entity in its own right)

Export access (spec.md's Export Credential entity) is represented by:

- A per-project R2 bucket (created on first request, research.md §8) — its EXISTENCE is the durable,
  persisted fact; FlightDeck does not need its own D1 row to track "does this project have a
  bucket," since the bucket's existence is queryable from R2 directly.
- A bucket-scoped R2 API token (Object Read only), created/revoked via Cloudflare's own API — the
  token's secret is returned ONCE at creation time (standard API-credential behavior) and is never
  stored by FlightDeck itself, only the fact that a token was issued (for `audit_log` purposes,
  constitution Principle X) and, if Cloudflare's API exposes a token ID, that ID (to support
  revocation without re-deriving which token to revoke).

**Validation rules**: revoking a project's export access revokes that project's token via
Cloudflare's API — it does NOT delete the underlying R2 bucket or its log data (spec.md's Edge
Cases: "Export credentials are compromised or need to be revoked: revoking them stops all further
access without affecting the underlying log data").

## Cross-entity relationship: log-to-trace linkage

Mirrors Module 3's error-to-trace relationship (data-model.md's "Cross-entity relationship" section
there) but in the opposite required/optional direction: every log record's `trace_id` is REQUIRED by
protocol (research.md §1), so `log_batch_traces` rows always exist for any batch containing log
lines emitted during an active trace — the "absent" case (spec.md FR-008/Edge Cases) is a log line
emitted with genuinely no active trace, which is possible (an SDK can still call `logger.info()`
outside any span) even though the field is structurally required on records that DO have one. Both
directions (trace → logs, log → trace) are looked up by matching `trace_id` at read time, same as
Module 3's linkage — no foreign-key enforcement, no denormalization beyond the junction table.
