# Quickstart: Distributed Tracing

## Prerequisites

- Module 2 (Error monitoring) running locally, including its migration applied —
  `specs/002-error-monitoring/quickstart.md`. This module's DSN, rate limiter, and envelope parser
  all come from Module 2.
- This module's migration applied locally: `deno task db:migrations:apply:local` (re-run after
  `0003_distributed_tracing.sql` is added).
- A local Cloudflare Queue configured for `wrangler dev` (`TRACE_INGEST` + `trace-ingest-dlq`) —
  see research.md §4's open verification item on local Queues emulation reliability; if it proves
  unreliable, the consumer's write logic can be exercised directly (bypassing the queue) as
  documented in that section's fallback.

## Validate User Story 1 — transactions and waterfalls

```sh
# Look up the demo project's DSN (same lookup as Module 2's quickstart)
deno run -A npm:wrangler d1 execute flightdeck-production --local \
  --command "SELECT id, dsn_public_key FROM projects WHERE id = 'demo'"
```

Configure a real `@sentry/browser` (or `@sentry/react`) instance and a real Python `sentry-sdk`
instance with tracing enabled (`tracesSampleRate: 1.0`), pointed at the demo DSN. Ideally, have the
JS instance call an endpoint served by the Python instance, so the resulting trace is genuinely
distributed (propagating `sentry-trace`/`baggage` across that hop) rather than single-service.
Trigger a traced operation from each, and confirm each appears in `GET /api/internal/traces` (or the
Traces screen in the browser) grouped by operation name. Open one transaction and confirm its
waterfall shows the recorded spans correctly nested and proportioned.

**Remember the async-ingest note** (contracts/trace-ingest-api.md): the ingest response returns
`200` before the transaction is queryable — allow a short delay (bounded by the queue consumer's
batch timeout) before checking.

Contract-level alternative (no real SDK install needed): hand-craft a `"transaction"`-type envelope
item matching `contracts/trace-ingest-api.md`'s grammar and `curl` it at
`http://127.0.0.1:8787/api/demo/envelope?sentry_key=<key>&sentry_version=7`.

## Validate User Story 2 — percentiles

```sh
curl http://127.0.0.1:8787/api/internal/traces -H "Cookie: fd_session=<local test session>"
```

Ingest several transactions sharing one operation name with known, deliberately varied durations
(e.g. five transactions at 100ms, 150ms, 200ms, 250ms, 900ms), then confirm the returned `p50Ms`/
`p95Ms` for that operation match what the known distribution's 50th/95th percentile should be.

## Validate User Story 3 — trace-to-error linkage

1. Trigger an error from inside the same traced operation used in User Story 1 (i.e. an error
   captured while a transaction/trace is active — most SDKs do this automatically once tracing is
   enabled and an exception occurs mid-transaction).
2. Confirm the resulting issue's detail response (`GET /api/internal/issues/{id}`) includes a
   non-null `traceId`.
3. Confirm the corresponding trace's detail response (`GET /api/internal/traces/{id}`, looked up via
   that `traceId`) lists the error in `linkedErrors`.
4. In the browser: open the issue, follow the "View trace" link, confirm it lands on that trace's
   waterfall; from there, confirm the linked error is shown and links back to the issue.

## Automated test commands

```sh
deno task test              # unit: transaction-dispatch, percentiles, waterfall-layout
deno task test:contract     # contract tests against a real wrangler dev (polls for async delivery)
deno task test:e2e           # traces-list → waterfall UI flow, issue↔trace cross-linking
```
