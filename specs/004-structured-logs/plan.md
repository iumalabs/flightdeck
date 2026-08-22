# Implementation Plan: Structured Logs

**Branch**: `004-structured-logs` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Status note**: Planned per explicit user instruction ("продолжай планировать Module 4"), same
posture as Modules 2-3 — `tasks.md` is produced for review, but starting implementation is a
separate decision. This branch was cut from `origin/main`, which now has Module 2 merged/live and
Module 3's planning docs merged (Module 3 itself still unimplemented). This module's migration is
numbered `0004_structured_logs.sql`, assuming Module 3's `0003_distributed_tracing.sql` lands first
when that module is eventually implemented — this module has no other file-level dependency on
Module 3 landing first, since its own tables (`log_batches`, `log_batches_fts`, `log_batch_traces`)
are new and additive.

## Summary

Ship FlightDeck's third ingest surface: structured log lines, via the SAME envelope endpoint
Modules 2-3 already extended (a new `"log"` item type, batching many records per submission per
Sentry's protocol — a materially different shape from one-error/one-transaction-per-item). Given log
volume is the highest of any data type FlightDeck ingests (illustrative: ~17M lines/day at a modest
10 req/sec × 20 lines/request), this module deliberately does NOT write one D1 row per log line —
instead, a new Cloudflare Queue (`LOG_INGEST`, independent from Module 3's `TRACE_INGEST`) buffers
writes, and a consumer batches records into time-partitioned NDJSON files in R2, with D1 holding
only a batch-level index (`log_batches`, FTS5-searchable, plus a `log_batch_traces` junction table
for trace correlation) — search and trace-lookup both resolve to candidate batches via D1, then
extract actual matching lines from R2 at read time. A new per-project Durable Object (`LiveTail`,
WebSocket Hibernation API) gives real-time streaming independent of the queue-based durable path.
S3-compatible export resolves a genuinely open question from this module's own scoping (R2 API
tokens can't be prefix-scoped, only bucket-scoped) into one dedicated R2 bucket per project,
provisioned on demand. Logs get their own 7-day retention default — shorter than Module 2's 90 days
and Module 3's 30 days — reasoned explicitly from volume, not copied.

## Technical Context

**Language/Version**: TypeScript (strict mode), Deno 2.x — unchanged from Modules 1-3.

**Primary Dependencies**: No new npm dependency. Cloudflare Queues (a second queue, `LOG_INGEST`)
and R2 (both the shared queue-consumer write path and dynamically-provisioned per-project buckets)
are platform bindings/API calls, not packages.

**Storage**: D1 (`log_batches`, `log_batches_fts` FTS5 virtual table, `log_batch_traces` — see
data-model.md), a new shared R2 bucket for the queue consumer's own bookkeeping is NOT needed —
instead, one R2 bucket PER PROJECT (dynamically created via the R2 API when export access is first
requested, or lazily on first log ingest for that project — see research.md §8), holding that
project's NDJSON log batches. A new Durable Object class, `LiveTail` (one instance per project).

**Testing**: `deno test` for pure-function units (log envelope-item dispatch, NDJSON batch
serialization, read-time line-extraction against a fake R2 object, retention query logic — mirroring
`tests/unit/retention.test.ts`'s existing pattern); contract tests against a real `wrangler dev`
using Module 3's established async-queue-polling pattern (research.md §10), extended to verify FTS5
search and the trace_id junction lookup; Playwright e2e for the search UI flow AND live tail
specifically (Playwright's native `page.waitForEvent('websocket')` support, confirmed — no separate
WebSocket test client needed).

**Target Platform**: Cloudflare Workers, same production/preview split as Modules 1-3. No new
deployable unit — the `LOG_INGEST` consumer is a second case in the same Worker's existing `queue()`
export (dispatching on `batch.queue`), alongside Module 3's `TRACE_INGEST` consumer.

**Performance Goals**: First-log-line-to-visible-in-live-tail under 10s (spec SC-001); a burst of
log traffic must not rate-limit that project's error/trace ingestion, and vice versa (spec SC-004)
— the independently-keyed `RateLimiter` DO instance (research.md §3) is what guarantees this.

**Constraints**: DSN-key auth and its own independent per-DSN-plus-category rate limit apply to log
ingest (constitution Principle III, extended per research.md §3); the new control-plane routes
(`GET /api/internal/logs/search`, the live-tail WebSocket upgrade, export credential
provision/revoke) stay `sessionAuth`-gated (Principle II), never DSN-gated; log retention MUST
default to a bounded window (Principle IX) — 7 days, the shortest of any module, justified by volume
(research.md §9); export-credential provisioning/revocation are admin mutations and MUST be
`audit_log`-recorded (Principle X), matching Module 2's precedent.

**Scale/Scope**: 1 new envelope item type on the existing ingest endpoint, 1 new Queue
binding+consumer case, 1 new Durable Object class, 3 new D1 tables/virtual-tables, dynamically
per-project-provisioned R2 buckets (not a static binding), 1 real screen replacing Module 1's Logs
empty state (two views: live tail + search) plus small additions to `TraceDetailScreen.tsx` and
`SettingsScreen.tsx`, 1 extension to the existing retention job.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate status |
|---|---|---|
| I. Two Trust Surfaces | Yes | **PASS by design** — log ingest reuses the SAME public, DSN-keyed envelope endpoint Module 2 established; every control-plane addition (search, live-tail WebSocket upgrade, export credential management) stays behind `sessionAuth`. No new trust-surface shape. |
| II. Defense-in-Depth (control plane) | Yes | **PASS** — new control-plane routes reuse the existing `sessionAuth` middleware unchanged, including the live-tail WebSocket upgrade handshake (the initial HTTP request that upgrades to WebSocket is itself `sessionAuth`-gated before the Durable Object accepts the connection). |
| III. DSN-Key Authentication (ingest) | Yes | **PASS by design** — log ingest goes through the exact same DSN-auth step as error/transaction ingest, unmodified; rate limiting is extended (not weakened) with its own independent category-keyed window (research.md §3). |
| IV. Sentry Protocol Compatibility | Yes — central to this module | **PASS** — the `"log"` envelope item shape (§1) matches Sentry's real, GA protocol per research.md, verified against develop.sentry.dev, not invented. No documented divergence needed. |
| V. Single Worker, One Module Per Pillar | Yes | **PASS** — log-ingest logic lives in `worker/modules/ingest/` alongside Module 2/3's error/transaction ingest code (shared envelope-dispatch machinery, same pillar boundary reasoning Module 3's plan already established: "one module per pillar's ingest surface," which errors/traces/logs all share). The search/live-tail control-plane routes get their own `worker/modules/logs/` module, mirroring Module 2's `issues/` and Module 3's `traces/` modules. |
| VI. Deno-Only Local Toolchain | Yes | **PASS** — no new npm dependency; Queues/R2/Durable Objects are `wrangler.jsonc` bindings and Cloudflare API calls, no new tooling outside Deno. |
| VII. One Configuration File | Yes, with a deliberate, explained exception | **PASS, reasoned explicitly** — the `LOG_INGEST` queue and `LiveTail` DO class ARE declared statically in `wrangler.jsonc` like every other binding. Per-PROJECT R2 buckets are NOT statically declared (there's no fixed, deploy-time-known set of projects) — this is the same pattern already established for per-project Durable Object instances (`idFromName()`-resolved at runtime, not one static binding per project) and does not introduce a second config file; bucket creation happens via a runtime Cloudflare API call, not a config declaration, so Principle VII (no separate `tsconfig.json`/`.eslintrc`-style parallel config surface) is unaffected — this is a data-plane provisioning action, not a build/tooling configuration. |
| VIII. Strict TypeScript, Test-First, Playwright | Yes | **PASS by design, with one documented testing wrinkle** — see Testing above: async queue-polling contract tests (Module 3's pattern) and Playwright's native WebSocket support for live tail (research.md §10), both decided rather than left open. |
| IX. Customer Telemetry Confidentiality | Yes — highest-volume telemetry surface yet | **PASS, with its own (shortest) retention number** — log bodies/attributes are customer telemetry exactly like Module 2's event payloads and Module 3's span data; 7-day default (research.md §9), reasoned explicitly from this module's volume being categorically higher than either prior module's. Per-project R2 buckets for export (research.md §8) are read-only-scoped tokens, revocable, audited — no broader credential than the export feature actually needs. |
| X. Admin Mutations Are Recorded | Yes | **PASS** — export-credential provisioning and revocation are new admin mutations on a project and MUST write `audit_log` entries (actor, before/after), matching Module 2's GitHub-connect/source-map-upload precedent exactly. Log ingest itself is not audit-logged per-line, same carve-out Module 2 established for event ingest. |
| XI. English-Only, Conventional Commits | Yes | **PASS** — unchanged, enforced by convention/review. |

No violations requiring the Complexity Tracking table — the one genuine design tension (per-project
R2 buckets vs. Principle VII's "one configuration file") is reasoned through above as consistent
with an existing pattern (per-project DO instances), not a new exception.

## Project Structure

### Documentation (this feature)

```text
specs/004-structured-logs/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── log-ingest-api.md
│   └── logs-internal-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root, additions to Modules 1-3's existing tree)

```text
wrangler.jsonc              # + Queue producer binding (LOG_INGEST) + consumer config,
                             # + Durable Object binding (LIVE_TAIL -> LiveTail class)
                             # NOTE: no static per-project R2 bucket bindings — provisioned via API
                             #   at runtime (research.md §8), unlike SOURCE_MAPS' static binding

worker/
├── index.ts                 # queue() export gains a second case, dispatching on batch.queue
│                             # ("trace-ingest" vs "log-ingest") to route to the right consumer
├── durable-objects/
│   └── live-tail.ts          # LiveTail DO class — WebSocket Hibernation API, one per project
│                             #   (research.md §7)
├── modules/
│   ├── ingest/
│   │   ├── envelope.ts         # + isLogItem() alongside isEventItem()/isTransactionItem()
│   │   ├── routes.ts           # + dispatch: "log" items → independent-keyed rate limit →
│   │   │                       #   LOG_INGEST.send() + LiveTail broadcast RPC (parallel, research.md §7)
│   │   ├── log-consumer.ts     # new — queue() batch handler for LOG_INGEST: NDJSON batch write to
│   │   │                       #   R2, log_batches/log_batches_fts/log_batch_traces D1 writes
│   │   └── retention.ts        # + prunes log_batches (+ R2 objects) past their own 7-day window
│   ├── logs/
│   │   ├── routes.ts           # new — GET /api/internal/logs/search, live-tail WebSocket upgrade,
│   │   │                       #   export credential provision/revoke (sessionAuth)
│   │   └── extract.ts          # new — shared "fetch R2 object(s), parse NDJSON, filter lines"
│   │                           #   function used by both search and trace-linkage lookups
│   └── traces/
│       └── routes.ts           # (Module 3) + logs-during-this-trace section, queries log_batch_traces
└── db/
    └── migrations/
        └── 0004_structured_logs.sql  # log_batches, log_batches_fts (FTS5), log_batch_traces

app/
├── shell/
│   ├── LogsScreen.tsx         # Module 1: static empty state → live tail + search views
│   └── TraceDetailScreen.tsx   # (Module 3) + logs-during-this-trace section
└── shell/SettingsScreen.tsx    # (Module 2) + S3-compatible export credential section

tests/
├── unit/
│   ├── log-dispatch.test.ts        # envelope item-type dispatch, NDJSON serialization
│   ├── log-extract.test.ts          # read-time line extraction against a fake R2 object
│   └── log-retention.test.ts        # mirrors tests/unit/retention.test.ts's pattern
├── contract/
│   └── log-ingest.spec.ts            # against real wrangler dev, polls for async queue delivery
│                                      # + FTS5 search + trace_id junction verification
└── e2e/
    └── logs-live-tail-and-search.spec.ts   # includes Playwright's native WebSocket assertions
```

**Structure Decision**: Extends Modules 1-3's existing `worker/` + `app/` + `tests/` layout — no new
top-level directories. `worker/modules/logs/` mirrors Module 2's `issues/` and Module 3's `traces/`
(sessionAuth-gated read/control routes for a pillar whose ingest logic lives in `ingest/`); log
ingest itself extends `worker/modules/ingest/` for the same reason Module 3's transaction ingest
did — shared envelope endpoint, DSN auth, and (now per-category-keyed) rate limiter.

## Complexity Tracking

*No unresolved Constitution Check violations — table omitted.*
