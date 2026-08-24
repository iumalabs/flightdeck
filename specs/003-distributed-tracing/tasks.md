---

description: "Task list for Distributed Tracing"

---

# Tasks: Distributed Tracing

**Input**: Design documents from `/specs/003-distributed-tracing/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution Principle VIII requires tests before a feature is done; this
module's highest-risk logic (transaction dispatch, percentile query construction, waterfall layout,
trace-to-error extraction) is pure-function-testable and gets unit coverage first, with contract
tests against a real `wrangler dev` for wire-format AND async-queue-delivery correctness
(research.md §9 — a genuinely new testing wrinkle versus Module 2) and Playwright for the UI flow.

**Organization**: Tasks are grouped by user story (US1-US3, matching spec.md's priorities: US1=P1,
US2=P2, US3=P2). US2 and US3 both depend on US1 (there must be real ingested transactions before
either an aggregate list or a cross-link has anything to show) but are independent of each other.

**✅ Status**: Implemented (all 38 tasks) — Module 2 (PR #7) is merged/live, satisfying plan.md's
dependency caveat. T010's Queues local-emulation spike was verified live against a real
`wrangler dev` during implementation (research.md §4) rather than left as an open risk; the
documented fallback design was not needed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

## Path Conventions

Extends Modules 1-2's `worker/` (Hono API) + `app/` (React SPA) + `tests/` (unit + contract + e2e)
layout — see plan.md's Structure Decision. No new top-level directories.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Create directory skeleton: `worker/modules/traces/`
- [X] T002 Add `TRACE_INGEST` Queue producer binding, its consumer config
      (`max_batch_size: 50`, `max_batch_timeout: 5`, `max_retries: 3`,
      `dead_letter_queue: "trace-ingest-dlq"`), and the `trace-ingest-dlq` queue itself to
      `wrangler.jsonc` (both `env.production` and `env.preview`, per Module 1/2's symmetric-envs
      pattern) — research.md §4

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, bindings wiring, and the transaction-vs-error dispatch split every user story
needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Create `worker/db/migrations/0003_distributed_tracing.sql` — additive
      `events.trace_id`/`events.span_id` nullable columns + `idx_events_trace_id` index; new
      `transactions` table (`id`, `project_id`, `trace_id`, `sdk_event_id`, `name`, `op`,
      `duration_ms`, `started_at`, `spans_json`, `received_at`) with `UNIQUE(project_id,
      sdk_event_id)` and the `(project_id, name, started_at)` + `(trace_id)` indexes per
      data-model.md
- [X] T004 Apply the migration locally: `deno task db:migrations:apply:local` (depends on T003)
- [X] T005 Add `isTransactionItem()` to `worker/modules/ingest/envelope.ts` alongside the existing
      `isEventItem()`, dispatching on the envelope item's `type` field (research.md §2) (depends on
      T001)
- [X] T006 [P] Wire an empty `queue(batch, env, ctx)` handler export into `worker/index.ts`'s
      default export (no-op body for now, alongside the existing `fetch`/`scheduled`) and mount an
      empty `tracesRoutes` router under `/api/internal/traces` as a sibling to `issuesRoutes`
      (depends on T001)
- [X] T007 Verify `deno task build` and `deno check` still pass with the new bindings/tables/empty
      routes wired in (smoke check, no new files)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - See where time actually goes in a request (Priority: P1) 🎯 MVP

**Goal**: A real Sentry SDK's traced operation becomes a visible, correctly-rendered span waterfall.

**Independent Test**: quickstart.md's "Validate User Story 1" — real SDKs (or hand-crafted
transaction envelope items per the contract-level alternative) against a running `wrangler dev`,
confirming a transaction and its spans arrive, get queued, get consumed, and render as a correctly
nested/proportioned waterfall.

### Tests for User Story 1

- [X] T008 [P] [US1] Write `tests/unit/transaction-dispatch.test.ts` (envelope item-type dispatch
      correctly separates `"transaction"` from `"event"`; `duration_ms` computation from
      `timestamp - start_timestamp` is correct, including fractional-second inputs) — expect it to
      fail until T012-T013 land
- [X] T009 [P] [US1] Write `tests/unit/waterfall-layout.test.ts` (a span's depth is correctly
      derived from `parent_span_id` chains; position/width are correctly proportional to
      `start_timestamp`/duration on the transaction's own time axis; a span with a dangling
      `parent_span_id` — no match among its siblings — is treated as a direct child of the root,
      per spec.md's Edge Cases, not dropped or erroring) — expect it to fail until T014 lands
- [X] T010 [US1] **Spike**: verify Cloudflare Queues' local emulation under `wrangler dev`
      reliably delivers a produced message to the `queue()` consumer end to end. Record the outcome
      in research.md §4/§9 — either confirm the contract test can assert against real local
      delivery, or record the documented fallback (test the producer's enqueue and the consumer's
      D1-write logic separately, invoking the consumer function directly rather than relying on
      local queue delivery) before T011 is written. Unlike Module 2's T027 spike, this does NOT
      gate T012/T013's implementation (Cloudflare Queues work in real deployed Workers regardless
      of local dev emulation) — it only determines T011's test design.
- [X] T011 [US1] Write `tests/contract/trace-ingest.spec.ts` (against real `wrangler dev`:
      hand-crafted transaction envelope matching contracts/trace-ingest-api.md; asserts `200` on
      enqueue; polls `GET /api/internal/traces/{id}` with bounded retries per research.md §9's
      async-delivery note — rather than asserting immediately — until the transaction is queryable
      or the poll budget is exhausted; asserts `403` for a bad DSN key) — expect it to fail until
      T012-T016 land (depends on T010)

### Implementation for User Story 1

- [X] T012 [US1] Implement transaction-item dispatch in `worker/modules/ingest/routes.ts`: after
      the existing DSN-auth + rate-limit steps (unchanged), a `"transaction"` item is parsed then
      pushed via `env.TRACE_INGEST.send()`; the request returns `200` immediately (contracts/
      trace-ingest-api.md) (depends on T005, T002, T008)
- [X] T013 [US1] Implement `worker/modules/ingest/trace-consumer.ts` — the `queue()` batch handler:
      per-message try/catch (independent ack/retry, not whole-batch), `duration_ms` computation,
      `db.batch()` write of each transaction's summary row + `spans_json` blob (research.md §4-6)
      (depends on T003, T004, T008, T010); wire this real handler into T006's stub in
      `worker/index.ts`
- [X] T014 [P] [US1] Implement `worker/modules/ingest/waterfall-layout.ts` — pure functions
      computing each span's depth (from `parent_span_id` chains, dangling references treated as
      root-level per spec.md's Edge Cases) and position/width (proportional to
      `start_timestamp`/duration on the transaction's time axis) (depends on T009)
- [X] T015 [US1] Implement `GET /api/internal/traces/:id` in `worker/modules/traces/routes.ts` per
      contracts/traces-internal-api.md (summary fields, `spans` from `spans_json`);
      `linkedErrors: []` stub for now — User Story 3 fills in the real lookup (depends on T013,
      T004)
- [X] T016 [US1] Wire the real `tracesRoutes` into `worker/index.ts` under `/api/internal/traces`,
      replacing T006's empty stub (depends on T015, T006)
- [X] T017 [P] [US1] Create `app/shell/TraceDetailScreen.tsx` — visual waterfall using T014's
      layout functions (horizontal bars positioned/sized via computed left/width, indented by
      depth), empty `linkedErrors` section rendered as absent for now (depends on T016)
- [X] T018 [US1] Add `selectedTraceId` state to `app/shell/AppShell.tsx` (mirrors research.md §11's
      `selectedIssueId` pattern); wire a `"trace-detail"` screen case routing to
      `TraceDetailScreen` (depends on T017)
- [X] T019 [US1] Run T008-T011's tests, confirm all pass (depends on T012-T018)

**Checkpoint**: A real SDK's traced operation reliably becomes a visible, correctly-rendered
waterfall.

---

## Phase 4: User Story 2 - Spot which operations are actually slow (Priority: P2)

**Goal**: The Traces list shows every operation with accurate p50/p95/count, grouped rather than a
raw per-transaction scroll.

**Independent Test**: quickstart.md's "Validate User Story 2" — ingest a known distribution of
durations for one operation name, confirm the returned p50/p95 match.

**Depends on**: User Story 1 (there must be real ingested transactions to aggregate, and this
story's row-click navigation lands on US1's trace detail view).

### Tests for User Story 2

- [X] T020 [P] [US2] Write `tests/unit/percentiles.test.ts` (the `ORDER BY`/`OFFSET` query-builder
      produces the correct offset for p50 and p95 against known-size distributions, including
      edge cases: a single-transaction operation, an even-count distribution) — expect it to fail
      until T021 lands

### Implementation for User Story 2

- [X] T021 [US2] Implement `worker/modules/ingest/percentiles.ts` — pure functions building the
      `ORDER BY duration_ms ASC LIMIT 1 OFFSET ...` query per research.md §7's exact pattern
      (depends on T020)
- [X] T022 [US2] Implement `GET /api/internal/traces` in `worker/modules/traces/routes.ts` —
      operations grouped by `name`, each with `p50Ms`/`p95Ms` (via T021, over the 24h window),
      `count`, and `latestTransactionId` (contracts/traces-internal-api.md) (depends on T021, T015)
- [X] T023 [US2] Replace `app/shell/TracesScreen.tsx`'s static empty state with the real grouped
      list (name/op/p50/p95/count columns, sortable by duration per spec.md Acceptance Scenario 3);
      clicking a row navigates to `TraceDetailScreen` via its `latestTransactionId` (depends on
      T022, T018)
- [X] T024 [US2] Run T020's test, confirm it passes (depends on T021)

**Checkpoint**: The Traces list correctly surfaces which operations are actually slow.

---

## Phase 5: User Story 3 - Jump from an error straight to what it happened during (Priority: P2)

**Goal**: Issue detail links to its originating trace; trace detail lists any errors that occurred
during it.

**Independent Test**: quickstart.md's "Validate User Story 3" — ingest an error and a transaction
sharing a `trace_id`, confirm each side's detail view links to the other.

**Depends on**: User Story 1 (the trace detail view this extends with `linkedErrors`).

### Tests for User Story 3

- [X] T025 [P] [US3] Write a unit test (`tests/unit/trace-context-extraction.test.ts`) for a new
      `extractTraceContext(event)` pure function — returns `{ traceId, spanId }` when
      `contexts.trace.trace_id` is present, `null` when absent — expect it to fail until T026 lands

### Implementation for User Story 3

- [X] T026 [US3] Implement `extractTraceContext()` (in `worker/modules/ingest/routes.ts` or a small
      sibling module) and wire it into the EXISTING, unchanged synchronous error-ingest code path:
      when present, store `trace_id`/`span_id` on the `events` insert (data-model.md) (depends on
      T025, T004)
- [X] T027 [US3] Add a `traceId` field to `GET /api/internal/issues/:id`'s response in
      `worker/modules/issues/routes.ts`, reading the latest event's `trace_id` column
      (contracts/traces-internal-api.md's addition to Module 2's contract) (depends on T026)
- [X] T028 [US3] Implement the real `linkedErrors` lookup (`SELECT ... FROM events WHERE trace_id =
      ?` joined to `issues`) in `GET /api/internal/traces/:id`, replacing T015's `[]` stub (depends
      on T026, T015)
- [X] T029 [P] [US3] Add a "View trace" link to `app/shell/IssueDetailScreen.tsx`, shown when
      `traceId` is present (absent — not an error state — otherwise, per spec.md FR-009) (depends
      on T027)
- [X] T030 [P] [US3] Add a linked-error(s) section to `app/shell/TraceDetailScreen.tsx`, shown when
      `linkedErrors` is non-empty (depends on T028, T017)
- [X] T031 [US3] Run T025's test, confirm it passes (depends on T026)

**Checkpoint**: All three user stories are independently functional; errors and traces are
cross-linked in both directions.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T032 Extend `worker/modules/ingest/retention.ts` to also prune `transactions` rows (full row,
      including `spans_json`) past their own 30-day window, on the same `scheduled()` cron trigger
      (research.md §8)
- [X] T033 [P] Write a unit test for the transactions-retention query logic (prunes old
      transactions, leaves recent ones) in `tests/unit/retention.test.ts` (extending the existing
      file) or a new sibling
- [X] T034 [P] Write `tests/e2e/traces-list-and-waterfall.spec.ts` — pre-authenticated context plus
      seeded D1 data, covering navigation from the Traces list into a transaction's waterfall, and
      the issue↔trace cross-linking flow in both directions
- [X] T035 [P] Run `deno fmt` and `deno lint` across `worker/`, `app/`, `tests/`; fix violations
- [X] T036 [P] Run `deno check` (typecheck) across every new/changed `.ts`/`.tsx` file
- [X] T037 Run the full `quickstart.md` validation end-to-end (all three user stories) and record
      results
- [X] T038 Update `README.md`'s Status section to reference `specs/003-distributed-tracing`;
      document the new `TRACE_INGEST`/`trace-ingest-dlq` Queue bindings in the Deployment section
      (Queues, unlike D1, have no separate migrations-application step, but do need the same kind
      of one-time provisioning note Module 1/2 gave D1/R2/DO bindings)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on User Story 1 (needs real transactions to aggregate, and
  its navigation lands on US1's detail view).
- **User Story 3 (Phase 5)**: Depends on User Story 1 (the trace detail view it extends). Does NOT
  depend on User Story 2 — independently deliverable once US1 exists.
- **Polish (Phase 6)**: Depends on all three user stories.

### Parallel Opportunities

- Setup: T001, T002 in parallel.
- Foundational: T003→T004 sequential (migration then apply); T005, T006 can proceed in parallel
  with each other once T001 lands; T007 after all.
- Within US1: T008, T009 (tests) in parallel; T010 (spike) blocks only T011, not T012-T014, which
  can proceed in parallel with T010/T011 once their own tests (T008/T009) exist.
- Within US2: only T020 is parallelizable (single implementation task chain after it).
- Within US3: T029, T030 (frontend) can proceed in parallel once their respective backend tasks
  (T027, T028) land.
- User Story 3 can proceed in parallel with User Story 2 (both depend only on US1, not each other).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Setup + Foundational
2. User Story 1
3. **STOP and VALIDATE**: run quickstart.md's User Story 1 validation against real SDKs
4. This alone proves the core "point an SDK with tracing enabled at a DSN, see a real waterfall"
   promise

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → validate independently → transactions + waterfalls work (MVP)
3. Add US2 → validate independently → the Traces list correctly surfaces slow operations
4. Add US3 → validate independently → errors and traces are cross-linked
5. Polish → retention job covers `transactions` (constitution Principle IX compliance),
   fmt/lint/typecheck clean, README current

### Notes

- US2 and US3 are both P2 and both depend only on US1 — they are NOT sequentially dependent on each
  other (unlike Module 2's US3, which depended on both US1 and US2). Either can be built second.
- Tests are written first within each story's phase and are expected to fail until that story's
  implementation tasks land (constitution Principle VIII).
- T010 (the Queues local-emulation spike) is lower-stakes than Module 2's T027 source-map spike —
  it affects only how T011's contract test is designed, not whether the production ingest path
  works, since Cloudflare Queues function in real deployed Workers regardless of local `wrangler
  dev` emulation fidelity.

---

## Phase 7: Convergence

**Purpose**: `/speckit-converge` pass against the current codebase (2026-08-24) — all 38 original
tasks are checked off and the core ingest → queue → waterfall → cross-link pipeline is real and
working, but independent re-verification against spec.md/plan.md found three gaps the original task
list never closed.

- [ ] T039 Add a contract- or integration-level test that ingests multiple transactions sharing one
      operation name with a known duration distribution and asserts `GET /api/internal/v1/traces`'s
      `p50Ms`/`p95Ms` match the expected values, per SC-004 and spec.md User Story 2's own
      Independent Test (missing) — `tests/unit/percentiles.test.ts` only unit-tests the pure
      `computeOffset()` arithmetic (`worker/modules/ingest/percentiles.ts`); no test anywhere
      exercises `percentileSql()`/`operationsListSql()`/`fetchPercentile()` against real seeded D1
      data (confirmed via repo-wide search: no test file references `p50Ms`, `p95Ms`,
      `operationsListSql`, or `fetchPercentile`), so SC-004's "verified by automated test" is
      currently satisfied only by a one-time manual spike recorded in research.md §4, not by
      standing test coverage.
- [ ] T040 Guard `worker/modules/ingest/routes.ts`'s transaction-item dispatch (around line 272,
      `await c.env.TRACE_INGEST.send(queued)`) against a serialized transaction payload that exceeds
      Cloudflare Queues' documented 128 KB max message size, rejecting it cleanly (e.g. `413`)
      instead of letting an oversized `.send()` throw uncaught into Hono's `app.onError` handler
      (`worker/index.ts`) and return a generic `500`, per FR-010 and spec.md's "an ingest payload is
      excessively large... it is rejected rather than accepted" edge case (partial) — the shared
      `MAX_ENVELOPE_BYTES` check (1 MB) only bounds the whole envelope, not one transaction item, and
      research.md §4 itself flags this exact gap as unresolved ("the plan should verify a realistic
      large transaction fits under 128 KB, not just under MAX_ENVELOPE_BYTES") with no evidence in
      code or tests that the verification, or a guard, was ever added.
- [ ] T041 Add an interactive sort/filter affordance to `app/shell/TracesScreen.tsx`'s Traces list
      (e.g. clickable column headers to toggle sort field/direction, or a duration filter control),
      per spec.md User Story 2 Acceptance Scenario 3, "When a developer sorts or filters by
      duration..." (partial) — the current implementation (lines 41, 60-78) only applies a fixed,
      non-interactive default sort by `p95Ms` descending with no way to change it and no filtering
      capability at all; the outcome (slowest operations visible without manual comparison) is
      arguably met by the default sort, but no "sorts or filters" action exists for a developer to
      take, as the acceptance scenario's wording describes.
