# Internal API Contract Additions: Structured Logs

All routes below are control-plane (constitution Principle I) and gated by the same `sessionAuth`
middleware Modules 1-3 established — none are reachable via the DSN-authenticated ingest surface,
and the ingest surface is never reachable through these.

## `GET /api/internal/logs/search`

Searches the current project's log history.

**Query parameters**: `q` (string, optional — free-text FTS5 query against `search_text`), `level`
(string, optional — one of `trace`/`debug`/`info`/`warn`/`error`/`fatal`), `from`/`to` (ISO
timestamps, optional — time-range bounds), `cursor` (string, optional — pagination, per spec.md's
"bounded, paginated" requirement).

**Behavior**: resolves candidate `log_batches` rows (via `log_batches_fts` MATCH when `q` is
present, filtered by `levels_present`/`started_at`/`ended_at` for `level`/`from`/`to` regardless),
then fetches and parses each candidate batch's R2 NDJSON object to extract the actual matching lines
(research.md §5) — using the shared extraction function (`worker/modules/logs/extract.ts`) also
used by the trace-linkage lookup below.

**Response `200`**:
```json
{
  "lines": [
    { "timestamp": "string", "level": "string", "body": "string", "attributes": {},
      "traceId": "string|null" }
  ],
  "nextCursor": "string|null"
}
```

`traceId` is present when the record carried one (the common case per research.md §1's "required by
protocol" note) — `null` only for the genuinely-no-active-trace case (spec.md FR-008/Edge Cases).

## `GET /api/internal/logs/live-tail` (WebSocket upgrade)

Upgrades to a WebSocket connection to the current project's `LiveTail` Durable Object.

**Auth**: the initial HTTP upgrade request is `sessionAuth`-gated (constitution Principle II) before
the Durable Object accepts the WebSocket — the DO itself does not re-authenticate each message, the
gate is entirely at the upgrade request.

**Behavior**: once connected, the client receives a message for every newly-arrived log batch pushed
to that project's `LiveTail` DO by the ingest route (research.md §7) — not replayed history; a
freshly-opened connection only sees records ingested after it connects (searching past history is
`GET /api/internal/logs/search`'s job, not live tail's).

**Message shape** (server → client, one per broadcast):
```json
{
  "records": [
    { "timestamp": "string", "level": "string", "body": "string", "attributes": {},
      "traceId": "string|null" }
  ]
}
```

## `POST /api/internal/projects/{id}/log-export/credential`

Provisions S3-compatible export access for a project's log data (research.md §8's resolution).

**Behavior**: creates the project's dedicated R2 bucket if it doesn't already exist; creates a
bucket-scoped, Object-Read-only R2 API token; writes an `audit_log` entry (constitution Principle
X). The token's secret is returned ONCE in this response and is never stored by FlightDeck itself
(data-model.md's Export Credential section) — if the caller loses it, they must revoke and
re-provision, not retrieve it again.

**Response `201`**:
```json
{
  "accessKeyId": "string",
  "secretAccessKey": "string",
  "endpoint": "string",
  "bucket": "string"
}
```

## `DELETE /api/internal/projects/{id}/log-export/credential`

Revokes a project's previously provisioned export access.

**Behavior**: revokes the R2 API token via Cloudflare's API; writes an `audit_log` entry. Does NOT
delete the underlying R2 bucket or its log data (spec.md's Edge Cases). Idempotent — revoking when
nothing is provisioned is a `200`, not a `404` (matching Module 2's GitHub-disconnect contract's
idempotency precedent).

**Response `200`**: empty body.

## Addition to `GET /api/internal/traces/{id}` (Module 3's existing contract)

The existing response gains one new field:

```json
{
  "...": "... all existing fields unchanged ...",
  "logs": [
    { "timestamp": "string", "level": "string", "body": "string" }
  ]
}
```

`logs` is `[]`, not omitted, when no log lines share this trace's `trace_id` (spec.md's "absent, not
an error state" pattern, matching Module 3's own `linkedErrors` field on the same endpoint). Resolved
via `log_batch_traces` (data-model.md) plus the same read-time R2 extraction search uses.

## Non-goals for this contract

- No endpoint to configure the retention window or search result page size — both are
  implementation defaults (research.md §9, this contract's `cursor` pagination), not user-facing
  configuration in this module.
- No structured query language (field:value syntax, boolean operators) for search — free-text `q`
  plus `level`/`from`/`to` filters only, per spec.md's Assumptions.
- No endpoint to list/browse a project's raw R2 bucket contents directly — that's what the
  provisioned S3-compatible credentials are for; FlightDeck's own API doesn't duplicate that.
