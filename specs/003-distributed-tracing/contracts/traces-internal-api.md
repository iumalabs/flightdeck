# Internal API Contract Additions: Distributed Tracing

All routes below are control-plane (constitution Principle I) and gated by the same `sessionAuth`
middleware Modules 1-2 established — none are reachable via the DSN-authenticated ingest surface,
and the ingest surface is never reachable through these.

## `GET /api/internal/traces`

Returns the current project's transactions, grouped by operation name, with on-demand percentile
figures (research.md §7) computed over the trailing 24 hours.

**Response `200`**:
```json
{
  "operations": [
    { "name": "string", "op": "string|null", "p50Ms": 0, "p95Ms": 0, "count": 0,
      "latestTransactionId": "string" }
  ]
}
```

`count` is the number of transactions contributing to that operation's percentile figures within
the 24-hour window — an operation with zero transactions in the window is simply absent from the
list, not shown with zeroed figures. `latestTransactionId` is that operation's most recently
started transaction's `id` — a deliberate MVP navigation shortcut: the Traces list is grouped by
operation (satisfying spec.md User Story 2's percentile-per-operation requirement), but clicking a
row needs to land on ONE specific transaction's waterfall (User Story 1) — rather than adding a
third list level ("all transactions for this operation"), which nothing in spec.md's acceptance
scenarios requires, clicking a row navigates straight to its most recent transaction's detail via
`GET /api/internal/traces/{latestTransactionId}`. A dedicated "browse all transactions for this
operation" view is not part of this contract and can be added later without a breaking change if a
real need for it emerges.

## `GET /api/internal/traces/{id}`

Returns one specific transaction's detail: its own summary fields, its full span tree (for waterfall
rendering), and any error(s) linked to the same `trace_id` (research.md §3, data-model.md's
cross-entity relationship section).

**Response `200`**:
```json
{
  "id": "string", "traceId": "string", "name": "string", "op": "string|null",
  "durationMs": 0, "startedAt": "string",
  "spans": [
    { "spanId": "string", "parentSpanId": "string|null", "op": "string",
      "description": "string|null", "startTimestamp": 0, "timestamp": 0, "status": "string|null" }
  ],
  "linkedErrors": [
    { "issueId": "string", "title": "string", "level": "string" }
  ]
}
```

`{id}` is the `transactions.id` (FlightDeck's own server-generated id), not the raw `trace_id` —
mirrors Module 2's `GET /api/internal/issues/{id}` using `issues.id`, not a fingerprint, as the path
parameter. `linkedErrors` is `[]`, not omitted, when no error shares this transaction's `trace_id`
(spec.md FR-009's "absent, not an error state" — an empty array is the absent case for a list field,
matching how Module 2's `suspectCommit` uses `null` for the absent case of a single-object field).

**Response `404`**: no transaction with that id in the caller's project.

## Addition to `GET /api/internal/issues/{id}` (Module 2's existing contract)

The existing response gains one new, always-present field:

```json
{
  "...": "... all existing fields unchanged ...",
  "traceId": "string|null"
}
```

`traceId` is the latest event's `trace_id` column (data-model.md), when present, letting the
dashboard render a "View trace" link to `GET /api/internal/traces/{id}` — but note the issue
response carries the raw `trace_id`, not a `transactions.id`; resolving it to a specific transaction
detail page requires a lookup by `trace_id` (the same lookup `GET /api/internal/traces/{id}`'s
`linkedErrors` performs in reverse), not a direct id match. `null` when the triggering event carried
no `contexts.trace` (spec.md's Edge Cases — not an error state).

## Non-goals for this contract

- No endpoint to configure the percentile time window or retention window — both are
  implementation defaults (research.md §7-8), not user-facing configuration in this module.
- No cross-project trace view — `GET /api/internal/traces` and its detail endpoint are scoped to
  the caller's project exactly like Module 2's issues endpoints, with the same "only one project
  exists yet" caveat inherited from Module 1/2.
