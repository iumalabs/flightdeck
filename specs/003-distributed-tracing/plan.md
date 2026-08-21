# Implementation Plan: Distributed Tracing

**Branch**: `003-distributed-tracing` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Status note**: Planned per explicit user instruction ("продолжай планировать Module 3"), same
posture as Module 2 — `tasks.md` is produced for review, but starting implementation is a separate
decision. This branch was cut from `origin/main` while Module 2 (`002-error-monitoring`, PR #7) is
still unmerged — per git-workflow's "don't stack open branches" rule, planning proceeds
independently since it's text-only and creates no file conflicts with that PR. This module's own
migration is numbered `0003_distributed_tracing.sql` on the assumption Module 2's
`0002_error_monitoring.sql` lands first; implementation of this module should not begin before PR
#7 merges, since it directly extends files PR #7 introduces (`worker/modules/ingest/routes.ts`,
`envelope.ts`, `retention.ts`, the `events` table).

## Summary

Ship FlightDeck's first performance-monitoring surface: transactions and spans ingested through the
SAME envelope endpoint Module 2 already built (`POST /api/{project_id}/envelope`, a new
`"transaction"` item type alongside `"event"`), written asynchronously via a new Cloudflare Queue
(not synchronously like errors — trace volume is structurally higher, so this module adopts Queues
now rather than deferring the way Module 2 did); a real Traces list grouped by operation name with
on-demand p50/p95 percentiles; a new Trace Detail screen rendering a real visual span waterfall; and
trace-to-error linkage in both directions (an issue shows its originating trace, a trace shows any
errors that occurred during it), the concrete implementation of the constitution's "shared
identifiers" goal. Introduces one new binding beyond Module 2's D1/R2/DO setup: a Cloudflare Queue
(`TRACE_INGEST`) plus its consumer. Extends, rather than duplicates, three of Module 2's existing
files (`ingest/routes.ts`, `ingest/envelope.ts`, `ingest/retention.ts`) and the `events` table
(additive `trace_id`/`span_id` columns).

## Technical Context

**Language/Version**: TypeScript (strict mode), Deno 2.x — unchanged from Modules 1-2.

**Primary Dependencies**: Everything from Module 2's `deno.json` — no new npm dependency needed;
Cloudflare Queues is a platform binding (`wrangler.jsonc`), not an npm package.

**Storage**: D1 (existing databases, one additive migration on `events`, one new `transactions`
table — see data-model.md), plus a new Cloudflare Queue (`TRACE_INGEST`, with a
`trace-ingest-dlq` dead-letter queue) for asynchronous trace-ingest write buffering (research.md
§4). No new R2 usage — span trees stay in D1 (research.md §6).

**Testing**: `deno test` for pure-function units (transaction-item dispatch, `duration_ms`
computation, percentile SQL construction, waterfall depth/position calculation) with no bindings
required; contract tests against a running `wrangler dev`, polling for the queue consumer's async
write to land rather than asserting immediately after the ingest response (research.md §9 — a real
difference from Module 2's synchronous contract tests); Playwright for the traces-list →
trace-detail waterfall flow and the issue↔trace cross-linking, using Module 1/2's
pre-authenticated-context pattern.

**Target Platform**: Cloudflare Workers, same production/preview split as Modules 1-2. No new
deployable unit — the queue consumer is a new export on the same Worker, not a separate service.

**Performance Goals**: First-transaction-to-visible-waterfall under 30s (spec SC-001); accurate
percentile figures under sustained early-stage-product trace volume with no observable ingestion
backlog (spec SC-006) — via the Queue + `db.batch()` write path (research.md §4-5), not direct
synchronous writes, precisely because trace volume doesn't fit Module 2's "direct D1 writes are
sufficient" reasoning.

**Constraints**: DSN-key auth and per-DSN rate limiting apply to trace ingest exactly as they
already do for errors (constitution Principle III, unchanged); the new `GET /api/internal/traces`
and `GET /api/internal/traces/:id`-equivalent control-plane routes stay `sessionAuth`-gated
(Principle II), never DSN-gated; trace/span retention MUST default to a bounded window
(Principle IX) — 30 days, distinct from and shorter than Module 2's 90-day event retention
(research.md §8, justified by trace volume, not inherited unexamined).

**Scale/Scope**: 1 new envelope item type on the existing ingest endpoint, 1 new Queue binding + 1
consumer handler, 1 new D1 table (`transactions`) + 1 additive migration on `events`, 2 new
app-shell screens (Traces list, Trace Detail waterfall) + 2 small additions to existing screens
(`IssueDetailScreen.tsx`'s trace link, `TracesScreen.tsx` replacing Module 1's empty state), 1
extension to the existing retention job.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate status |
|---|---|---|
| I. Two Trust Surfaces | Yes | **PASS by design** — trace ingest reuses the SAME public, DSN-keyed envelope endpoint Module 2 already established (not a new public route to re-justify); every control-plane addition (`GET /api/internal/traces`, trace detail) stays behind `sessionAuth`. No new trust-surface shape introduced. |
| II. Defense-in-Depth (control plane) | Yes | **PASS** — new control-plane routes reuse the existing `sessionAuth` middleware unchanged. |
| III. DSN-Key Authentication (ingest) | Yes | **PASS by design** — trace ingest goes through the exact same DSN-auth + per-DSN rate-limit steps as error ingest (research.md §1-2), unmodified. No separate auth path invented for transactions. |
| IV. Sentry Protocol Compatibility | Yes — central to this module | **PASS** — transaction envelope item shape (`type`, `start_timestamp`, `timestamp`, `contexts.trace`, `spans[]`, `transaction_info`) matches Sentry's real protocol per research.md §2, verified against develop.sentry.dev, not invented. No documented divergence needed for this module (unlike Module 2's source-map-upload-endpoint divergence, which was itself constitution-sanctioned). |
| V. Single Worker, One Module Per Pillar | Yes | **PASS** — trace ingest/storage logic lives in `worker/modules/ingest/` alongside Module 2's error-ingest code (same pillar, extending shared envelope-dispatch machinery, not a new pillar) since tracing and error monitoring share one ingest surface by protocol design, not by convenience. The Traces list/detail control-plane routes get their own `worker/modules/traces/` module, mirroring Module 2's `issues/` module. |
| VI. Deno-Only Local Toolchain | Yes | **PASS** — no new npm dependency; Cloudflare Queues is configured via `wrangler.jsonc` bindings, no new tooling outside Deno. |
| VII. One Configuration File | Yes | **PASS** — new Queue producer/consumer bindings added to the existing `wrangler.jsonc`; no new config file. |
| VIII. Strict TypeScript, Test-First, Playwright | Yes | **PASS with a noted testing wrinkle** — see Testing above and research.md §9: the queue-based ingest path needs polling contract tests rather than the immediate-assertion pattern Module 2 used, an explicit, documented deviation from that pattern rather than a silent one. |
| IX. Customer Telemetry Confidentiality | Yes | **PASS, with its own retention number rather than inheriting Module 2's** — span/tag data in `spans_json` is customer telemetry exactly like Module 2's event payloads; retention defaults to 30 days (research.md §8), reasoned explicitly from trace volume rather than copied from Module 2's 90-day figure. No new secret introduced (Queues need no credential beyond the existing Worker binding). |
| X. Admin Mutations Are Recorded | No | **N/A** — this module introduces no new admin/control-plane mutation actions (no connect/disconnect/upload flow); ingest is not an admin mutation per the constitution's own carve-out (unchanged reasoning from Module 2). |
| XI. English-Only, Conventional Commits | Yes | **PASS** — unchanged, enforced by convention/review. |

No violations requiring the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/003-distributed-tracing/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── trace-ingest-api.md
│   └── traces-internal-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root, additions to Modules 1-2's existing tree)

```text
wrangler.jsonc              # + Queue producer binding (TRACE_INGEST), + consumer config
                             # (max_batch_size, max_batch_timeout, max_retries, dead_letter_queue)

worker/
├── index.ts                 # + queue() handler export (new — was fetch/scheduled only through Module 2)
│                             # + mounts tracesRoutes as a sibling to issuesRoutes (research.md §2)
├── modules/
│   ├── ingest/
│   │   ├── envelope.ts         # + isTransactionItem() alongside existing isEventItem() (research.md §2)
│   │   ├── routes.ts           # + dispatch: "transaction" items → TRACE_INGEST.send(), unchanged
│   │   │                       #   error path for "event" items (research.md §2, §4)
│   │   │                       # + trace_id/span_id extraction from contexts.trace on error events
│   │   │                       #   (research.md §3)
│   │   ├── trace-consumer.ts   # new — queue() batch handler, duration_ms computation, db.batch()
│   │   │                       #   writes (research.md §4-5)
│   │   ├── percentiles.ts      # new — pure ORDER BY/OFFSET query-builder functions (research.md §7)
│   │   └── retention.ts        # + prunes `transactions` rows past their own 30-day window
│   │                           #   (research.md §8)
│   └── traces/
│       └── routes.ts           # new — GET /api/internal/traces, GET /api/internal/traces/:id
│                               #   (sessionAuth), including linked-error lookup by trace_id
└── db/
    └── migrations/
        └── 0003_distributed_tracing.sql  # events.trace_id/span_id (additive), transactions table

app/
├── shell/
│   ├── TracesScreen.tsx       # Module 1: static empty state → real list, fetches /api/internal/traces
│   ├── TraceDetailScreen.tsx   # new — visual span waterfall, linked error(s)
│   └── IssueDetailScreen.tsx   # Module 2: + "View trace" link when the event carries a trace_id
└── shell/AppShell.tsx          # + selectedTraceId state (mirrors research.md §11's selectedIssueId
                                # pattern), routes to TraceDetailScreen

tests/
├── unit/
│   ├── transaction-dispatch.test.ts   # envelope item-type dispatch, duration_ms computation
│   ├── percentiles.test.ts             # ORDER BY/OFFSET query-builder correctness
│   └── waterfall-layout.test.ts        # span depth/position pure-function calculation
├── contract/
│   └── trace-ingest.spec.ts            # against real wrangler dev, polls for async queue delivery
│                                        # (research.md §9) — includes a spike check for local
│                                        # Queues emulation reliability
└── e2e/
    └── traces-list-and-waterfall.spec.ts   # includes the issue↔trace cross-linking flow
```

**Structure Decision**: Extends Modules 1-2's existing `worker/` + `app/` + `tests/` layout — no new
top-level directories. `worker/modules/traces/` mirrors Module 2's `worker/modules/issues/`
(sessionAuth-gated read routes for a pillar whose ingest logic lives elsewhere); trace ingest logic
itself extends `worker/modules/ingest/` rather than getting a sibling module, since it shares the
envelope endpoint, DSN auth, and rate limiter with error ingest by protocol design (constitution
Principle V's "one module per pillar" is read here as "per pillar's *ingest surface*", which errors
and traces share, not "per pillar's *entire feature*").

## Complexity Tracking

*No unresolved Constitution Check violations — table omitted.*
