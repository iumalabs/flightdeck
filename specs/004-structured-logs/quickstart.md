# Quickstart: Structured Logs

## Prerequisites

- Module 2 (Error monitoring) running locally, migration applied — its DSN issuance is what this
  module's ingest reuses.
- Module 3 (Distributed tracing) implemented and its migration applied — this module's trace
  correlation (`log_batch_traces`) needs Module 3's `trace_id` concept to exist end-to-end,
  though log ingest itself does not hard-depend on Module 3's own tables.
- This module's migration applied locally: `deno task db:migrations:apply:local` (re-run after
  `0004_structured_logs.sql` is added).
- A local Cloudflare Queue configured for `wrangler dev` (`LOG_INGEST`) — see Module 3's quickstart
  for the equivalent local-Queues-emulation caveat; the same open verification item applies here.

## Validate User Story 1 — live tail

```sh
deno run -A npm:wrangler d1 execute flightdeck-production --local \
  --command "SELECT id, dsn_public_key FROM projects WHERE id = 'demo'"
```

Configure a real `@sentry/browser` (or `@sentry/react`) instance and a real Python `sentry-sdk`
instance with logging enabled (`enableLogs: true` / `enable_logs=True`), pointed at the demo DSN.
Open the project's live tail view in the dashboard, trigger log-emitting activity in each
application, and confirm the log lines appear in the view within seconds. Filter by level and
confirm only matching lines continue to appear as new ones arrive.

Contract-level alternative (no real SDK install needed): hand-craft a `"log"`-type envelope item
matching `contracts/log-ingest-api.md`'s grammar and `curl` it at
`http://127.0.0.1:8787/api/demo/envelope?sentry_key=<key>&sentry_version=7`, while a WebSocket
client (or Playwright's `page.waitForEvent('websocket')`, research.md §10) is connected to
`GET /api/internal/logs/live-tail`.

## Validate User Story 2 — search

```sh
curl "http://127.0.0.1:8787/api/internal/logs/search?q=<distinctive-word>" \
  -H "Cookie: fd_session=<local test session>"
```

Ingest a batch of log lines with varied, known content, levels, and timestamps. Search by a
distinctive word from one of them and confirm it's returned; filter by level and confirm only
matching lines are returned; filter by time range and confirm only lines within it are returned.

**Remember the async-ingest note** (contracts/log-ingest-api.md): allow a short delay after the
`200` response before searching, bounded by the queue consumer's flush interval.

## Validate User Story 3 — trace-to-log linkage

1. Trigger log-emitting activity from inside the same traced operation used in User Story 1/2 of
   Module 3's quickstart (i.e. logging that happens while a transaction/trace is active).
2. Confirm the trace's detail response (`GET /api/internal/traces/{id}`) includes the log lines in
   its `logs` field.
3. Confirm a log line's search result (`GET /api/internal/logs/search`) includes a non-null
   `traceId`, and that following it (looking up that trace's detail) leads back to the correct
   trace.
4. In the browser: open the trace's detail view, confirm the logs-during-this-trace section shows
   the expected lines; from a log search result, follow its trace link, confirm it lands on the
   correct trace's waterfall.

## Validate User Story 4 — S3-compatible export

```sh
curl -X POST http://127.0.0.1:8787/api/internal/projects/demo/log-export/credential \
  -H "Cookie: fd_session=<local test session>"
```

Confirm the response contains `accessKeyId`/`secretAccessKey`/`endpoint`/`bucket`. Configure a
standard S3-compatible client (e.g. `aws-cli` with a custom endpoint) with these credentials and
confirm it can list and retrieve that project's archived NDJSON log batches, and that the same
credentials do NOT grant access to any other project's bucket. Revoke via `DELETE` on the same path
and confirm the credentials stop working.

## Automated test commands

```sh
deno task test              # unit: log-dispatch, log-extract, log-retention
deno task test:contract     # contract tests against a real wrangler dev
deno task test:e2e           # live tail + search UI flow, trace<->log cross-linking
```
