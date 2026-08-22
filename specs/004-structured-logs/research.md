# Research: Structured Logs

Consolidates protocol research (Sentry's real structured-logging feature, researched against
develop.sentry.dev) and Cloudflare-platform research (live tail, D1 FTS5, R2 S3-compatibility,
Cloudflare Pipelines, R2 token scoping) gathered before writing this module's spec/plan, plus the
scope decisions made from them. Written in the same decision/rationale/alternatives format as
Modules 2-3's research.md.

## 1. Log envelope item & protocol

**Decision**: Envelope item type is the literal string `"log"`. An envelope MUST contain at most one
`log` item, and — unlike Module 2's `"event"` (one error) or Module 3's `"transaction"` (one
transaction, spans nested inside) — a `"log"` item's `items` array batches MANY independent log
records per submission (Sentry SDKs cap this at 100 logs/envelope). Item header: `type: "log"`,
`item_count` (must match the array length), `content_type:
"application/vnd.sentry.items.log+json"`.

Per-record fields, confirmed: `timestamp` (required), `trace_id` (required, 32 hex chars — every log
record is trace-correlated by protocol design), `level` (required — `trace`/`debug`/`info`/`warn`/
`error`/`fatal`), `body` (required, the message string), `span_id` (optional, 16 hex chars),
`severity_number` (optional), `attributes` (optional — a typed map where each value is
`{"value": <typed_value>, "type": "<string|integer|...>"}`, not a bare scalar — this is
OpenTelemetry's `AnyValue` shape). Sentry's own docs confirm the schema is "fully OpenTelemetry
compatible, following OTEL semantic conventions for log and span attributes" — FlightDeck's data
model can lean on OTel's LogRecord shape as grounding, not just Sentry's docs.

SDK API: `Sentry.logger.info(...)` (six level methods) behind `Sentry.init({ enableLogs: true })`
(JS) / `sentry_sdk.init(enable_logs=True)` (Python, `sentry-sdk` 2.35.0+) — confirmed GA (Sentry's
"Logs in Sentry — Generally Available" announcement), not beta, so this module can commit to the
protocol shape with the same confidence Module 2/3 had for errors/transactions.

**Source**: https://develop.sentry.dev/sdk/telemetry/logs.md,
https://develop.sentry.dev/sdk/data-model/envelope-items/,
https://docs.sentry.io/platforms/python/logs/

## 2. Ingest routing: extend the existing envelope dispatch, don't duplicate it

**Decision**: `worker/modules/ingest/envelope.ts` gains `isLogItem()` alongside its existing
`isEventItem()`/`isTransactionItem()` (Module 3's addition) — same envelope, same
`POST /api/{project_id}/envelope` endpoint, same DSN-auth step, dispatched purely by the item's
`type` field. No new public route.

## 3. Independent rate limiting: logs get their own window, not a shared one

**Decision**: Reuse the existing `RateLimiter` Durable Object class (Module 2) unchanged, but key
the log-ingest path's instance as `` `${dsnKey}:log` `` rather than the bare `dsnKey` Module 2/3 use
for errors/transactions — a genuinely separate DO instance with its own independent window/budget.

**Rationale**: Sentry's own protocol confirms logs use a distinct, named rate-limit data category,
`log_item` (both native `log` and OTel-sourced `otel_log` envelopes share it) — this isn't an
invented distinction, it's how the real protocol expects rate-limit signaling to work. More
importantly: log volume is structurally much higher than error or transaction volume (§4) — sharing
one per-DSN counter would let a legitimate burst of log traffic exhaust the same budget that
protects error ingestion, effectively letting verbose logging silently break error reporting. Spec
SC-004 makes this an explicit, testable requirement, not just an implementation nicety.

**Implementation consequence**: since which rate-limit key(s) apply depends on which item TYPES an
envelope actually contains, the rate-limit check moved from "before parsing" (Module 2/3's original
ordering) to "after parsing, before project resolution" — parsing itself is cheap/bounded (already
gated by `MAX_ENVELOPE_BYTES`), so this doesn't weaken the fail-fast posture, it just needs to know
an envelope's item types before it can pick the right limiter(s). An envelope mixing log items with
error/transaction items checks both limiters independently; either one denying rejects the whole
request.

## 4. Storage architecture: Queue + R2 NDJSON + batch-granularity D1 index, not Cloudflare Pipelines

**Decision (confirmed via explicit scoping choice)**: ingest pushes each envelope's batched log-item
array as ONE Cloudflare Queue message onto a new `LOG_INGEST` queue (separate from Module 3's
`TRACE_INGEST` — different consumer logic and message shape; keeping them independent means a
backlog in one doesn't delay the other). A `queue()` consumer accumulates incoming messages and, per
flush, concatenates every record across the flush into ONE newline-delimited JSON (NDJSON) object,
written to a new `LOGS` R2 bucket, time-partitioned:
`{project_id}/{yyyy}/{mm}/{dd}/{hh}/{batch-id}.ndjson`. D1 gets ONE ROW PER R2 OBJECT WRITTEN, not
per log line — a `log_batches` table (`id`, `project_id`, `r2_object_key`, `started_at`, `ended_at`,
`record_count`, `levels_present`).

**Rationale, reasoned from actual volume, not assumed**: even a modest, realistic early-stage
workload — 10 req/sec, 20 log lines per traced request — is ~17.3M log lines/day. One D1 row per log
line would blow through the 100,000 row-writes/day free tier in under 9 minutes. This isn't a
theoretical edge case; it's the expected common case for any app with routine `logger.info()`-style
instrumentation.

**Cloudflare Pipelines was explicitly declined** despite being a closer managed-product fit
(automatic time-partitioned R2 sinks in NDJSON/Parquet — architecturally almost exactly this
module's need) because it requires a Workers **Paid** plan and is in **open beta** — both directly
conflict with the constitution's self-hostable/free-tier-friendly posture that every prior module
has protected (Module 2 chose direct D1 writes over Queues specifically to stay simple/free-tier at
MVP scale; Module 3 adopted Queues, still free-tier, specifically because it stayed within Queues'
own free-tier availability). Building the narrow ingest→R2-NDJSON→index path manually costs more
code but keeps this module deployable on the same free tier as every other module — a deliberate,
scope-bounded tradeoff (spec.md's out-of-scope list: "this module does NOT attempt to replicate
Pipelines' broader ETL feature set").

**Source**: https://developers.cloudflare.com/pipelines/,
https://developers.cloudflare.com/pipelines/sinks/available-sinks/r2/,
https://developers.cloudflare.com/queues/platform/limits/ (128KB max message size — one batched
log-item array, capped at 100 records by the SDK, comfortably fits)

## 5. Search: FTS5 at batch granularity, read-time line extraction

**Decision**: A `log_batches_fts` D1 FTS5 virtual table, rowid-linked to `log_batches`, indexing a
`search_text` column — the concatenation of every record's `body` plus its string-typed `attributes`
values within that batch. A search query narrows to candidate BATCHES via FTS5 (BM25-ranked), then
the actual matching individual lines are extracted at READ time by fetching the corresponding R2
NDJSON object(s) and filtering/parsing them server-side — never pre-extracted into D1. Structured
filters (level, project, time range) filter `log_batches`' plain columns directly; `levels_present`
supports a coarse pre-filter before any per-line extraction happens.

**Rationale**: this is the same fundamental tradeoff Module 2 made choosing R2-for-blobs over
D1-for-blobs (source maps), applied here at a coarser, batch-level granularity because log volume is
categorically higher than source-map-upload volume — a small amount of read-path latency (fetching
and scanning a batch's NDJSON file) buys a large reduction in write volume and D1 storage, which is
the actual scarce resource at this data volume. D1's FTS5 support is confirmed directly from
Cloudflare's own SQL statements page ("FTS5 module for full-text search"), not assumed.

**Caveat, noted for the implementation phase**: FTS5 virtual tables cannot be included in D1's
export/backup tooling directly (a documented gap — the workaround is drop-virtual-tables → export →
recreate) — irrelevant to this module's own function, but worth flagging for whoever eventually
writes an operator backup runbook.

**Bug found and fixed during live verification**: a free-text query passed directly as FTS5's
`MATCH` argument is interpreted using FTS5's OWN query syntax (hyphens, quotes, `AND`/`OR`/`NOT`,
column filters) — a query like `"zzz-nonexistent-zzz"` gets parsed as a hyphen-prefixed NOT-clause
and throws `SQLITE_ERROR: no such column`, confirmed live against a real `wrangler dev` (a genuine
runtime error, not a hand-crafted edge case). Fixed by quoting the query as an FTS5 string literal
(`"user query"`, doubling any embedded `"`) before binding it — `toFts5MatchLiteral()` in
`worker/modules/logs/routes.ts`, unit-tested directly.

**Source**: https://developers.cloudflare.com/d1/sql-api/sql-statements/

## 6. Trace-to-log linkage

**Decision**: a small junction table, `log_batch_traces` (`batch_id`, `trace_id`) — ONE ROW PER
DISTINCT trace_id present in a batch, not per log line — written by the same queue-consumer flush
that writes the batch's `log_batches`/`log_batches_fts` rows. Indexed on `trace_id` for a fast,
properly-indexed "show me all logs for this trace" lookup (Module 3's trace detail view extends to
query this), avoiding both a full-table scan and the write-volume cost of a per-line index.

**Rationale**: every log record carries a REQUIRED `trace_id` per Sentry's protocol (§1) — trace
correlation isn't optional the way it is for error events (Module 3's `events.trace_id` is nullable,
since an error can occur with no active trace) — but a batch typically groups log lines from
multiple concurrent requests/traces, so indexing at the batch level (with a small per-distinct-trace
junction row) is the right granularity: cheap to write, genuinely useful to query, without
reintroducing per-line D1 rows.

## 7. Live tail: WebSocket via a per-project Durable Object, Hibernation API

**Decision**: `LiveTail extends DurableObject`, one instance per project (`idFromName(projectId)`),
using the WebSocket Hibernation API (`state.acceptWebSocket()`) rather than the older
always-in-memory WebSocket pattern. The ingest route, on receiving a `"log"` item, does TWO
independent things after the existing DSN-auth/rate-limit steps: pushes the batch to `LOG_INGEST`
(§4, durable storage) AND calls the project's `LiveTail` DO via RPC to broadcast the new records to
connected viewers — in parallel, not sequentially; live tail must not wait for the queue consumer's
batched write, or it wouldn't be live.

**Rationale**: Cloudflare's own docs confirm Durable Objects "can act as WebSocket servers that
connect thousands of clients per instance" with no hard documented connection cap, and — critical
for a feature where a dashboard tab may sit open and idle for a long time — the Hibernation API
means "Billable Duration (GB-s) charges do not accrue during hibernation" while the client stays
connected. Server-Sent Events and polling were both considered and rejected: SSE from a Workers
`fetch()` handler doesn't have the same well-documented long-lived-connection support Durable
Objects' WebSocket handling does, and polling can't deliver the "within seconds" latency spec.md's
SC-001 requires without either wasteful short-interval polling or noticeably laggy UX.

**Note on idle-connection timeouts**: 100s idle timeout on Free/Pro plans — the DO should send
periodic pings (or rely on hibernation's wake-on-message behavior) so a genuinely idle-but-open
live-tail tab doesn't silently disconnect; this is an implementation detail for the tasks phase, not
a design blocker.

**Bug found and fixed during live e2e verification**: `webSocketClose(ws, code, reason, wasClean)`
re-closing with whatever `code` the client sent threw
`InvalidAccessError: Invalid WebSocket close
code` for real browser-initiated closes — a browser
navigating away or dropping the connection often reports one of the WebSocket spec's RESERVED codes
(1005 "No Status Received", 1006 "Abnormal Closure"), which are legal to receive but illegal to pass
back into `.close()` yourself. Fixed by substituting a valid code (1000) whenever the received one
falls in a reserved/invalid range, wrapped in try/catch as a last-resort guard — confirmed via a
real Playwright e2e run against a real browser WebSocket connection, not just unit-level reasoning.

**Source**: https://developers.cloudflare.com/durable-objects/best-practices/websockets/,
https://developers.cloudflare.com/durable-objects/release-notes/,
https://developers.cloudflare.com/changelog/2025-10-31-increased-websocket-message-size-limit

## 8. S3-compatible export: resolved — one R2 bucket per project, not prefix-scoped tokens

**Decision (resolves spec.md's explicitly-flagged open item)**: R2 API tokens can be scoped to a SET
OF BUCKETS, but **not to a path prefix within a bucket** — confirmed directly from Cloudflare's own
token documentation: "Object Read & Write and Object Read only can both be scoped to specific
buckets" with no mention of prefix/path-level scoping anywhere in the token-creation options. This
was a real unknown going into this research pass, not assumed either way, and it resolves in the
less-convenient direction: a single shared `LOGS` bucket with per-project prefix-scoped tokens is
**not possible** with genuine, standing, revocable R2/S3 credentials (only presigned URLs support
path-scoping, and those are time-limited — a poor fit for "provision export access" as an ongoing
credential a customer configures once into their own pipeline, per spec.md FR-012's "standard
S3-compatible client... using the provided credentials," which implies a standing key pair, not an
expiring link).

**Resolution: one R2 bucket per project**, provisioned on demand when export access is first
requested (not eagerly for every project). Cloudflare's documented per-account bucket limit is
1,000,000 — not a meaningful constraint at any realistic FlightDeck scale (self-hosted or hosted).
`POST /api/internal/projects/{id}/log-export/credential` creates the project's dedicated bucket if
it doesn't exist yet, creates a bucket-scoped R2 API token (Object Read only — export is read-only
per spec.md's scenarios, no need to grant write), and returns the resulting access key
ID/secret/endpoint; a corresponding `DELETE` revokes the token. Both are admin mutations and get an
`audit_log` entry (constitution Principle X), matching Module 2's GitHub connect/disconnect and
source-map-upload precedent.

**Consequence for the queue consumer (§4) — CORRECTED during implementation**: the framing above
(the hot ingest path writing directly into a dynamic, per-project bucket) turned out not to hold up.
Workers R2 bindings are static — confirmed directly (no documented mechanism exists to resolve an R2
bucket binding dynamically at runtime the way `idFromName()` resolves a Durable Object instance;
object-level PUT/GET against a bucket with no static binding requires the S3-compatible API with AWS
SigV4 request signing, a materially different and heavier mechanism than an `R2Bucket` binding
call). Putting that on the HOT ingest path (every log-ingest request) for a P1 user story would be a
real complexity/risk increase to the module's most load-bearing code path, for a requirement (export
isolation) that only P3's User Story 4 actually needs.

**Revised architecture**: primary log storage (User Stories 1-3) uses ONE shared, statically-bound
`LOGS` R2 bucket — the exact same pattern Module 2's `SOURCE_MAPS` bucket already establishes (one
bucket, `{project_id}/...`-prefixed keys, isolation enforced by FlightDeck's own D1-driven
`project_id`-scoped queries, not by R2 ACLs). No new secret, no SigV4, needed for ingest/search/
live-tail/trace-linkage at all. Per-project buckets are reserved for EXACTLY the case that actually
needs bucket-level isolation: a customer's own external S3-compatible client (User Story 4), which
genuinely cannot be prefix-scoped (the constraint this section already correctly identified). At
export-credential-provisioning time, FlightDeck (a) creates the project's dedicated bucket and a
customer-facing read-only token via `CLOUDFLARE_R2_ADMIN_TOKEN` (unchanged from below), then (b)
mints a SHORT-LIVED, FlightDeck-owned write-scoped token for that same new bucket (same admin token,
same token-creation call, different permission group), and (c) uses that token with `aws4fetch` (a
purpose-built, Workers-compatible AWS SigV4 request-signing library — the standard, documented way
to make S3-compatible calls from a Worker without hand-rolling signing) to copy that project's
currently-known `log_batches` objects (enumerated precisely from D1, not guessed) from the shared
`LOGS` bucket into the new dedicated bucket. This is a bounded, one-time SNAPSHOT at provisioning
time, not an ongoing live sync — logs ingested after provisioning are not automatically mirrored
into the export bucket; spec.md does not require this (SC-006 only requires a provisioned credential
can list/retrieve that project's data, not that it stays current forever), and building continuous
mirroring is out of this module's MVP scope. `aws4fetch` is added as this module's only new npm
dependency, used exclusively by this one, low-frequency, P3 code path.

**Testing honesty note**: User Story 4's actual behavior against a real Cloudflare account
(bucket/token creation, the aws4fetch-signed copy, a real S3 client listing/retrieving the result)
is NOT verified by this module's automated tests — no `CLOUDFLARE_R2_ADMIN_TOKEN` with genuine R2
admin scope is available in this project's automated test/CI environment, and provisioning one is a
real-account action outside what this implementation pass is authorized to do unilaterally. What IS
verified: the request-CONSTRUCTION logic against Cloudflare's documented API shapes (unit tests,
mocked `fetch`, `tests/unit/log-export-token.test.ts`). This mirrors Module 5's own precedent for
its real-`sentry-cli` validation step — reserved for human-run verification, named explicitly here
rather than silently assumed to work.

**Alternatives considered**: presigned URLs generated by FlightDeck's own export endpoint (rejected
— doesn't satisfy "standard S3-compatible client... list and retrieve" the way spec.md's FR-012
requires; presigned URLs are single-object/time-limited, not a standing credential a customer's
`aws-cli` or existing pipeline could just be pointed at). A single shared bucket with
application-level access checks in front of it (rejected — R2's S3-compatible API is what makes
"standard client" access possible at all; putting FlightDeck's own auth layer in front of it would
mean building a custom S3-API-compatible proxy, which is a much larger undertaking than provisioning
per-project buckets, and reintroduces exactly the kind of custom-protocol-shim work Module 2's
research explicitly avoided for source-map uploads by NOT trying to be sentry-cli-compatible).

**Source**: https://developers.cloudflare.com/r2/api/tokens/,
https://developers.cloudflare.com/r2/platform/limits/,
https://developers.cloudflare.com/r2/api/s3/api/

## 9. Retention: shortest window of any module so far

**Decision**: log data (R2 NDJSON objects + their `log_batches`/`log_batches_fts`/`log_batch_traces`
rows) is pruned after **7 days**, shorter than both Module 2's 90-day event retention and Module 3's
30-day transaction retention.

**Rationale**: logs are the highest-volume data type across all modules (§4's 17M-lines/day
illustrative estimate) — against the same D1 free-tier ceilings (100k writes/day, 500MB storage) and
R2's own storage costs at scale, a week of searchable/live-tail-able history is a considered,
conservative MVP default (long enough to investigate "what happened this week," short enough to keep
storage bounded even at real usage levels), not an arbitrary number. Extends the existing
`worker/modules/ingest/retention.ts` (already pruning Module 2's `events`, and, per Module 3's plan,
`transactions`) with the same full-deletion behavior Module 3 established: a `log_batches` row has
no separate summary/aggregate to preserve (unlike Module 2's issue/event split), so pruning past the
window is complete deletion, not partial.

## 10. Testing: async queue polling (Module 3's pattern) plus a WebSocket test harness decision

**Decision**: contract tests for the log-ingest path follow Module 3's established polling pattern
(research.md §9 there) — POST a log envelope item, then poll `GET /api/internal/logs/search` with
bounded retries until the content becomes queryable, rather than asserting immediately after the
`200` response (queue-consumer processing is asynchronous here too).

**T009's `LOG_INGEST` local-Queues-emulation spike — CONFIRMED during implementation**: verified
live, the same way Module 3's `TRACE_INGEST` spike was — started a real `wrangler dev`, POSTed a
hand-crafted `"log"` envelope item, and confirmed the resulting `log_batches`/`log_batches_fts`/
`log_batch_traces` rows and the R2 NDJSON object all landed correctly, independently of Module 3's
own queue. This is a genuinely separate verification (two independent queue bindings), not assumed
to transfer from Module 3's own confirmed outcome, and it did not need the documented fallback
either.

For live tail specifically: Playwright DOES support WebSocket assertions natively via
`page.waitForEvent('websocket')` and the resulting `WebSocket` object's `framereceived`/ `framesent`
events — this is a real Playwright API, not a gap requiring an out-of-band test client. Live-tail
e2e coverage therefore stays inside the existing Playwright suite (open the live-tail view, ingest a
log line via a parallel `request` call, assert the expected frame arrives), rather than needing a
separate raw-WebSocket-client test tool — consistent with keeping all UI-flow testing in one
framework rather than introducing a second one for a single feature.

## 11. Frontend: navigation and cross-linking

**Decision**: `app/shell/LogsScreen.tsx` (Module 1's static empty state) becomes real, offering both
a live tail view (opens a WebSocket to the project's `LiveTail` DO) and a search view (hits
`GET /api/internal/logs/search`) — reachable from the same screen, not two separate sidebar entries,
since spec.md's two P1 user stories are two facets of one "Logs" destination, not separate
navigation targets. A log line's trace correlation links to Module 3's `TraceDetailScreen`; that
screen itself gains a logs-during-this-trace section (queries `log_batch_traces`). Continues Module
2/3's established component-state-based `AppShell.tsx` navigation — no URL routing introduced here
either, consistent with research.md §11 (Module 2) / §10 (Module 3)'s reasoning, which still applies
unchanged.
