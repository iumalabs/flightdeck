# Ingest API Contract: Error Monitoring

Public, DSN-authenticated (constitution Principle III) — no Cloudflare Access, no `fd_session`
cookie. This is the data-plane surface constitution Principle I introduces for the first time.

## `POST /api/{project_id}/envelope/`

**Auth**: A `sentry_key` resolving to `projects.dsn_public_key` for `{project_id}`, supplied via
**either**:
- `X-Sentry-Auth` header: `Sentry sentry_version=7, sentry_client=<any>, sentry_key=<key>`, or
- Query string: `?sentry_version=7&sentry_key=<key>`

Both are checked; if both are present they must agree (research.md §1). Missing, unknown, or
mismatched key → `403`, no envelope processed, no data recorded (spec FR-002).

**Request body**: `application/x-sentry-envelope` (also accepted: `text/plain`,
`multipart/form-data`, `application/x-www-form-urlencoded`, per real-world SDK behavior) — the
envelope grammar from research.md §2: `envelope-header-json \n (item-header-json \n item-payload
\n)*`.

**Behavior**:
1. Rate-limit check against the per-DSN Durable Object (research.md §4). Over limit → `429` +
   `X-Sentry-Rate-Limits: {retry_after}:{categories}:{scope}`, envelope not processed.
2. Parse envelope items. `event`-type items are processed; any other item type is skipped (its
   `length` header is used to skip past its payload) without causing the request to fail
   (research.md §2).
3. For each `event` item: resolve the DSN key → project; deduplicate on `(project_id,
   sdk_event_id)` (spec FR-014) — a duplicate is a no-op, not an error; if the event references a
   release with an available source map, resolve the stack trace against it (research.md §7)
   *before* fingerprinting; compute the fingerprint (research.md §5); upsert the `issue` row
   (`UNIQUE(project_id, fingerprint)`), incrementing `event_count`/updating `last_seen`; insert the
   `event` row.
4. Payloads beyond the configured maximum size are rejected (spec FR-013) — the specific limit is
   an implementation detail set during task execution, not part of this contract's interface shape.

**Response**: `200` on successful envelope acceptance (matches real Sentry SDK expectations — SDKs
do not require the response body to contain anything meaningful, only a success status). `403`
(auth failure), `429` (rate limited), `400` (malformed envelope that can't be parsed at all).

## Non-goals for this contract

- No `/api/{project_id}/store/` endpoint (research.md §1 — not needed for the two target SDKs'
  current versions).
- No `/api/{project_id}/minidump/` endpoint — out of scope per spec.md.
- `internal` is a reserved `{project_id}` value and MUST NOT resolve to any project (research.md
  §3) — this is a defensive invariant, not a feature.
