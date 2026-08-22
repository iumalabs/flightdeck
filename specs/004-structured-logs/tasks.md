---

description: "Task list for Structured Logs"

---

# Tasks: Structured Logs

**Input**: Design documents from `/specs/004-structured-logs/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution Principle VIII requires tests before a feature is done; this
module's highest-risk logic (log-item dispatch, NDJSON serialization, read-time line extraction,
retention) is pure-function-testable and gets unit coverage first, with contract tests against a
real `wrangler dev` for wire-format AND async-queue-delivery correctness (Module 3's established
pattern) and Playwright (including its native WebSocket support) for the UI/live-tail flow.

**Organization**: Tasks are grouped by user story (US1-US4, matching spec.md's priorities: US1=P1,
US2=P1, US3=P2, US4=P3). US3 and US4 both depend on US1's ingest/storage pipeline existing; US2
(search) also depends on US1's write path (nothing to search without it). US3 and US4 are
independent of each other.

**✅ Status**: Implemented (all 43 tasks) — Module 3 was implemented and merged first, satisfying
plan.md's dependency caveat. Two real bugs were found and fixed during live verification against a
real `wrangler dev` (not just unit-level reasoning): FTS5's `MATCH` argument needed explicit quoting
(a hyphenated search query otherwise threw `SQLITE_ERROR`), and `webSocketClose` needed to guard
against the WebSocket spec's reserved close codes (1005/1006) that real browsers send — see
research.md §5 and §7. User Story 4 (S3 export)'s live behavior against a real Cloudflare account is
NOT automated-test-verified (research.md §8's Testing honesty note) — only its request construction
is (`tests/unit/log-export-token.test.ts`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- File paths are relative to the repository root

## Path Conventions

Extends Modules 1-3's `worker/` (Hono API) + `app/` (React SPA) + `tests/` (unit + contract + e2e)
layout — see plan.md's Structure Decision. No new top-level directories.

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [P] Create directory skeleton: `worker/modules/logs/`
- [x] T002 Add `LOG_INGEST` Queue producer binding + consumer config (`max_batch_size`,
      `max_batch_timeout`, `max_retries`, a `log-ingest-dlq` dead-letter queue, mirroring Module 3's
      `TRACE_INGEST` config shape), a `LIVE_TAIL` Durable Object binding (`LiveTail` class), and a
      new required secret `CLOUDFLARE_R2_ADMIN_TOKEN` (account-level R2 bucket/token management —
      distinct from this Worker's own static R2 bindings, needed for dynamic per-project bucket/
      token provisioning, research.md §8) to `wrangler.jsonc` (both `env.production` and
      `env.preview`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, bindings wiring, and the log-vs-trace-vs-error dispatch split every user story
needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 Create `worker/db/migrations/0004_structured_logs.sql` — `log_batches` (`id`,
      `project_id`, `r2_object_key`, `started_at`, `ended_at`, `record_count`, `levels_present`,
      `received_at`) with the `(project_id, started_at)` index; `log_batches_fts` (FTS5 virtual
      table, rowid-linked, indexing `search_text`); `log_batch_traces` (`batch_id`, `trace_id`,
      `UNIQUE(batch_id, trace_id)`, indexed on `trace_id`) per data-model.md
- [x] T004 Apply the migration locally: `deno task db:migrations:apply:local` (depends on T003)
- [x] T005 Add `isLogItem()` to `worker/modules/ingest/envelope.ts` alongside the existing
      `isEventItem()`/`isTransactionItem()`, dispatching on the envelope item's `type` field
      (research.md §1-2) (depends on T001)
- [x] T006 Extend `worker/index.ts`'s `queue()` export to dispatch by `batch.queue` name (routing to
      Module 3's trace consumer vs. this module's log consumer — a Worker exports one `queue()`
      handler total but can bind to multiple queues); mount an empty `logsRoutes` router under
      `/api/internal/logs` as a sibling to `tracesRoutes`/`issuesRoutes` (depends on T002)
- [x] T007 Implement `worker/modules/logs/r2-provision.ts`'s `getOrCreateProjectBucket(projectId)` —
      idempotent: checks whether a project's dedicated R2 bucket already exists (via the Cloudflare
      API, using `CLOUDFLARE_R2_ADMIN_TOKEN`) and creates it if not, returning the bucket name for
      the queue consumer to write into (research.md §8) — this is the bucket-resolution half only;
      export-credential/token issuance is US4's concern, not this task's (depends on T002)
- [x] T008 Verify `deno task build` and `deno check` still pass with the new bindings/tables/empty
      routes/stub module wired in (smoke check, no new files)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Watch logs arrive in real time (Priority: P1) 🎯 MVP

**Goal**: A real Sentry SDK's log lines become durably stored (R2 + D1 index) AND appear live in a
WebSocket-fed dashboard view, within seconds of being emitted.

**Independent Test**: quickstart.md's "Validate User Story 1" — real SDKs (or hand-crafted log
envelope items per the contract-level alternative) against a running `wrangler dev`, confirming log
lines both stream live and are durably recorded.

### Tests for User Story 1

- [x] T009 [P] [US1] Write `tests/unit/log-dispatch.test.ts` (envelope item-type dispatch correctly
      identifies `"log"` items and extracts the batched `items` array; NDJSON serialization of a
      batch of records round-trips correctly) — expect it to fail until T013-T014 land
- [x] T010 [US1] **Spike**: confirm Cloudflare Queues' local emulation under `wrangler dev` reliably
      delivers producer→consumer for the `LOG_INGEST` queue specifically — a second, independent
      queue from Module 3's `TRACE_INGEST`, so Module 3's own spike outcome (tasks.md T010 there)
      does not automatically transfer; record the outcome in research.md §10, applying the same
      fallback reasoning Module 3's spike established if local emulation proves unreliable
- [x] T011 [P] [US1] Write the live-tail portion of `tests/e2e/logs-live-tail-and-search.spec.ts`,
      using Playwright's native `page.waitForEvent('websocket')` support (research.md §10) — open
      the live-tail view, ingest a log line via a parallel `request` call, assert the expected
      WebSocket frame arrives — expect it to fail until T012-T017 land

### Implementation for User Story 1

- [x] T012 [US1] Implement `worker/durable-objects/live-tail.ts` — `LiveTail extends DurableObject`,
      one instance per project, using the WebSocket Hibernation API (`state.acceptWebSocket()`,
      research.md §7); a `broadcast(records)` RPC method pushes to all connected sockets; a
      `fetch()` handler completes the WebSocket upgrade (depends on T002)
- [x] T013 [US1] Implement `"log"`-item dispatch in `worker/modules/ingest/routes.ts`: rate-limit
      check against the independently-keyed `` `${dsnKey}:log` `` `RateLimiter` DO instance
      (research.md §3), DSN auth (unchanged), parse the batched `items` array, then
      `env.LOG_INGEST.send()` and a `LiveTail` broadcast RPC call IN PARALLEL (not sequential —
      research.md §7), returning `200` (contracts/log-ingest-api.md) (depends on T005, T002, T012,
      T009)
- [x] T014 [US1] Implement `worker/modules/ingest/log-consumer.ts` — the `queue()` batch handler for
      `LOG_INGEST`: resolves the project's R2 bucket via T007, concatenates the flush's records into
      one NDJSON object and writes it, then `db.batch()` writes the `log_batches` +
      `log_batches_fts` rows (data-model.md) — `log_batch_traces` junction rows are deferred to User
      Story 3, not written here (depends on T003, T004, T007, T010)
- [x] T015 [US1] Wire the `LOG_INGEST` case into `worker/index.ts`'s `queue()` dispatch, replacing
      T006's stub routing (depends on T014, T006)
- [x] T016 [US1] Implement `GET /api/internal/logs/live-tail`'s WebSocket upgrade in
      `worker/modules/logs/routes.ts`, `sessionAuth`-gated before proxying to the project's
      `LiveTail` DO (contracts/logs-internal-api.md) (depends on T012, T006)
- [x] T017 [P] [US1] Create `app/shell/LogsScreen.tsx`'s live tail view — opens the WebSocket,
      renders a scrolling, level-filterable stream (depends on T016)
- [x] T018 [US1] Run T009-T011's tests, confirm all pass (depends on T013-T017)

**Checkpoint**: A real SDK's log lines reliably stream live and are durably recorded.

---

## Phase 4: User Story 2 - Find what happened after the fact (Priority: P1)

**Goal**: Search over a project's log history by text, level, and time range, correctly and with
bounded/paginated results.

**Independent Test**: quickstart.md's "Validate User Story 2" — ingest known log lines, confirm
search-by-text, level filtering, and time-range filtering all return the correct subset.

**Depends on**: User Story 1 (there must be durably-written batches to search).

### Tests for User Story 2

- [x] T019 [P] [US2] Write `tests/unit/log-extract.test.ts` (given a fake R2 object's NDJSON
      content, correctly extracts lines matching a text query, a level, and/or a time range; returns
      an empty result gracefully for no matches) — expect it to fail until T021 lands
- [x] T020 [US2] Write `tests/contract/log-ingest.spec.ts` (against real `wrangler dev`:
      hand-crafted `"log"` envelope items matching contracts/log-ingest-api.md; polls
      `GET /api/internal/logs/search` with bounded retries per research.md §10's async-delivery
      pattern rather than asserting immediately; asserts FTS5 search finds ingested content by text;
      asserts `403` for a bad DSN key; asserts the log-ingest rate limit is independent from the
      error/transaction one per spec SC-004) — expect it to fail until T021-T023 land

### Implementation for User Story 2

- [x] T021 [US2] Implement `worker/modules/logs/extract.ts` — the shared "fetch R2 object(s), parse
      NDJSON, filter lines" function (research.md §5), used by both search and (later, User Story 3)
      the trace-linkage lookup (depends on T019)
- [x] T022 [US2] Implement `GET /api/internal/logs/search` in `worker/modules/logs/routes.ts` — FTS5
      `MATCH` query construction against `log_batches_fts`, level/time-range filtering on
      `log_batches`' plain columns, cursor-based pagination, calling T021's extraction for the final
      matched lines (contracts/logs-internal-api.md) (depends on T021, T015)
- [x] T023 [P] [US2] Create `app/shell/LogsScreen.tsx`'s search view — query text, level, and
      time-range filters, paginated results list (depends on T022)
- [x] T024 [US2] Run T019-T020's tests, confirm all pass (depends on T021-T023)

**Checkpoint**: Historical log search works correctly and independently of live tail.

---

## Phase 5: User Story 3 - Jump between a trace and its logs (Priority: P2)

**Goal**: A trace's detail view shows the logs emitted during it; a log line shows and links to its
originating trace.

**Independent Test**: quickstart.md's "Validate User Story 3" — ingest a trace and log lines sharing
a trace_id, confirm each side's detail view links to the other.

**Depends on**: User Story 1 (the ingest/storage pipeline this extends) and User Story 2 (the
extraction function this reuses). Independent of User Story 4.

### Tests for User Story 3

- [x] T025 [P] [US3] Write a unit test for building `log_batch_traces` junction rows from a batch of
      log records (extracts the correct set of DISTINCT trace_ids, one row each, not one per log
      line) — expect it to fail until T026 lands

### Implementation for User Story 3

- [x] T026 [US3] Extend `worker/modules/ingest/log-consumer.ts` (T014) to also write
      `log_batch_traces` rows — one per distinct `trace_id` present in the flush's records (depends
      on T025, T014)
- [x] T027 [US3] Add a `logs` field to `GET /api/internal/traces/:id` in Module 3's
      `worker/modules/traces/routes.ts`, querying `log_batch_traces` by `trace_id` then extracting
      matching lines via T021 (contracts/logs-internal-api.md's addition to Module 3's contract)
      (depends on T026, T021)
- [x] T028 [US3] Add `traceId` to each line in `GET /api/internal/logs/search`'s response (depends
      on T022)
- [x] T029 [P] [US3] Add a logs-during-this-trace section to Module 3's
      `app/shell/TraceDetailScreen.tsx` (depends on T027)
- [x] T030 [P] [US3] Add trace-link rendering to `LogsScreen.tsx`'s search results, shown when
      `traceId` is present (absent — not an error state — otherwise, per spec.md FR-008) (depends on
      T028, T023)
- [x] T031 [US3] Run T025's test, confirm it passes (depends on T026)

**Checkpoint**: Logs and traces are cross-linked in both directions.

---

## Phase 6: User Story 4 - Take log data elsewhere (Priority: P3)

**Goal**: Project-scoped, revocable S3-compatible export access, usable by a standard S3-compatible
client.

**Independent Test**: quickstart.md's "Validate User Story 4" — provision export access, confirm a
standard S3-compatible client can list/retrieve exactly that project's data and no other's; revoke,
confirm access stops.

**Depends on**: User Story 1 (there must be a project bucket with data in it — T007's bucket
resolution helper). Independent of User Stories 2 and 3.

### Tests for User Story 4

- [x] T032 [P] [US4] Write a unit test for the export-token request-shape logic (given a bucket
      name, constructs the correct Cloudflare API request for a bucket-scoped, Object-Read-only
      token) — expect it to fail until T033 lands

### Implementation for User Story 4

- [x] T033 [US4] Extend `worker/modules/logs/r2-provision.ts` with `createExportToken(bucketName)`/
      `revokeExportToken(tokenId)`, calling Cloudflare's account-level API via
      `CLOUDFLARE_R2_ADMIN_TOKEN` (research.md §8) (depends on T032, T002)
- [x] T034 [US4] Implement `POST /api/internal/projects/:id/log-export/credential` and
      `DELETE /api/internal/projects/:id/log-export/credential` in `worker/modules/logs/routes.ts`
      per contracts/logs-internal-api.md, each writing an `audit_log` entry (constitution Principle
      X) (depends on T033, T007)
- [x] T035 [P] [US4] Add an S3-compatible export section to `app/shell/SettingsScreen.tsx`
      (generate/revoke credential), matching Module 2's source-map-upload/GitHub-connect form style
      (depends on T034)
- [x] T036 [US4] Run T032's test, confirm it passes (depends on T033)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T037 Extend `worker/modules/ingest/retention.ts` to prune `log_batches` rows (+ their
      `log_batches_fts` rows + `log_batch_traces` rows + the underlying R2 NDJSON objects) past
      their own 7-day window (research.md §9), on the same `scheduled()` cron trigger
- [x] T038 [P] Write a unit test for the log-retention query logic (prunes old batches, leaves
      recent ones), mirroring `tests/unit/retention.test.ts`'s existing pattern
- [x] T039 [P] Write the search-and-cross-linking portion of
      `tests/e2e/logs-live-tail-and-search.spec.ts` (extends T011's file) — search UI flow,
      trace↔log cross-linking in both directions
- [x] T040 [P] Run `deno fmt` and `deno lint` across `worker/`, `app/`, `tests/`; fix violations
- [x] T041 [P] Run `deno check` (typecheck) across every new/changed `.ts`/`.tsx` file
- [x] T042 Run the full `quickstart.md` validation end-to-end (all four user stories) and record
      results
- [x] T043 Update `README.md`'s Status section to reference `specs/004-structured-logs`; document
      the new `CLOUDFLARE_R2_ADMIN_TOKEN` secret and `LOG_INGEST`/`LIVE_TAIL` bindings in the
      Environment/Deployment sections

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on User Story 1 (needs durably-written batches to search).
- **User Story 3 (Phase 5)**: Depends on User Story 1 (the consumer it extends) and User Story 2
  (the extraction function it reuses).
- **User Story 4 (Phase 6)**: Depends on User Story 1 (the bucket-resolution helper). Independent of
  User Stories 2 and 3.
- **Polish (Phase 7)**: Depends on all four user stories.

### Parallel Opportunities

- Setup: T001, T002 in parallel.
- Foundational: T003→T004 sequential (migration then apply); T005, T006, T007 can proceed in
  parallel with each other once T001/T002 land; T008 after all.
- Within US1: T009, T011 (tests) in parallel; T010 (spike) blocks only what depends on the real
  queue consumer (T014), not T012/T013, which can proceed once their own tests exist.
- Within US2: T019 alone before T021; T023 can proceed in parallel with T020's contract test once
  T022 lands.
- User Story 3 and User Story 4 can proceed in parallel with each other (both depend only on User
  Story 1/2, not on each other).
- Within US4: T032 alone before T033; T035 can proceed once T034 lands.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Setup + Foundational
2. User Story 1
3. **STOP and VALIDATE**: run quickstart.md's User Story 1 validation against real SDKs
4. This alone proves the core "point an SDK with logging enabled at a DSN, watch logs stream live"
   promise — and, since the same write path is what search/trace-linkage/export build on, is a
   genuinely load-bearing MVP, not just a demo.

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → validate independently → live tail + durable storage work (MVP)
3. Add US2 → validate independently → historical search works
4. Add US3 → validate independently → logs and traces are cross-linked
5. Add US4 → validate independently → S3-compatible export works
6. Polish → retention job covers `log_batches` (constitution Principle IX compliance, shortest
   window of any module), fmt/lint/typecheck clean, README current

### Notes

- US3 and US4 are both dependent on US1 but independent of each other — either can be built second
  after US2, unlike Module 2's US3/US4 which had a strict linear dependency chain.
- Tests are written first within each story's phase and are expected to fail until that story's
  implementation tasks land (constitution Principle VIII).
- T010 (the `LOG_INGEST` local-Queues-emulation spike) is a NECESSARY re-verification, not redundant
  with Module 3's T010 — they're two independent queue bindings, and Module 3's outcome does not
  automatically transfer, even though the underlying platform question (does `wrangler dev` reliably
  emulate Queues locally) is the same one being asked twice.
