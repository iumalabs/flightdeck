---

description: "Task list for Uptime Monitoring"

---

# Tasks: Uptime Monitoring

**Input**: Design documents from `/specs/006-uptime-monitoring/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution Principle VIII requires tests before a feature is done; this
module's highest-risk logic is the shared `runCheck()` evaluation function's pure decision-making
(consecutive-failure/recovery counting, incident transitions), tested with network I/O mocked, plus
a dedicated test proving constitution Principle V's shared-evaluation-logic requirement is actually
honored by construction, not just by convention.

**Organization**: Tasks are grouped by user story (US1-US4, matching spec.md's priorities: US1=P1,
US2=P1, US3=P2, US4=P3). US2 and US3 both extend US1's `runCheck()`/`checks` foundation but are
independent of each other. US4 depends on US2 (webhooks fire on incident transitions, which US2
introduces).

**Status**: Implemented and verified — all 36 tasks complete. `deno fmt`/`deno lint`/`deno check`
clean; 15 new unit tests (decide.ts's pure decision logic, http-check.ts with fetch mocked, the
Principle V shared-path proof, retention, webhook fire-and-forget) all pass; 6 new contract tests
against a real `wrangler dev` (manual trigger, threshold-crossing incident open/resolve, delete-
with-open-incident, minimum-interval rejection, webhook delivery via a request-capturing local
listener) all pass; the real scheduled-cron dispatch path was separately live-verified via
`wrangler dev`'s `/cdn-cgi/local/scheduled` simulation (a due check ran with `trigger: "scheduled"`
and correctly advanced `next_run_at`); 1 new e2e test (check creation → manual trigger →
threshold-crossing incident → Alerts cross-link) passes. Two real bugs were found and fixed during
live contract testing — see research.md §10.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- File paths are relative to the repository root

## Path Conventions

Extends Modules 1-5's `worker/` (Hono API) + `app/` (React SPA) + `tests/` (unit + contract + e2e)
layout — see plan.md's Structure Decision. No new top-level directories, no new Cloudflare bindings
beyond a second `triggers.crons` entry.

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [P] Create directory skeleton: `worker/modules/uptime/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema and the scheduled/interactive dispatch scaffolding every user story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Create `worker/db/migrations/0006_uptime_monitoring.sql` — `checks`, `check_runs`,
      `incidents` per data-model.md, including `checks`' `interval_seconds` default/constraints and
      the `(check_id, run_at)` index on `check_runs`
- [x] T003 Apply the migration locally: `deno task db:migrations:apply:local` (depends on T002)
- [x] T004 Add a second `triggers.crons` entry (`"* * * * *"`, both `env.production` and
      `env.preview`) to `wrangler.jsonc`, alongside Module 2's existing retention cron (research.md
      §3)
- [x] T005 Wire an empty uptime case into `worker/index.ts`'s existing `scheduled()` handler, and
      mount an empty, `sessionAuth`-gated `uptimeRoutes` router under `/api/internal` (depends on
      T001, T004)
- [x] T006 Verify `deno task build` and `deno check` still pass with the new bindings/tables/empty
      routes wired in (smoke check, no new files)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Know whether a service is reachable (Priority: P1) 🎯 MVP

**Goal**: Configured HTTP/TCP checks run on schedule and correctly report up/down status.

**Independent Test**: quickstart.md's "Validate User Story 1" — create checks against known-
reachable and known-unreachable targets, confirm correct status after a scheduled (or
`wrangler dev`'s scheduled-trigger simulation) run.

### Tests for User Story 1

- [x] T007 [P] [US1] Write `tests/unit/uptime-evaluate.test.ts` (given a mocked successful/failed
      `fetch()` or `cloudflare:sockets` `connect()` result, `runCheck()` correctly determines
      success/failure and updates `consecutive_failures`/ `consecutive_successes`/`status`; a TCP
      check's evaluation is independent of an HTTP check's) — expect it to fail until T009 lands
- [x] T008 [US1] Write `tests/contract/uptime-checks.spec.ts` (against real `wrangler dev`: create
      an HTTP check and a TCP check, use `wrangler dev`'s scheduled-trigger simulation to fire a
      run, confirm each check's status/`check_runs` row is correct for a reachable vs. unreachable
      target) — expect it to fail until T009-T012 land

### Implementation for User Story 1

- [x] T009 [US1] Implement `worker/modules/uptime/evaluate.ts`'s `runCheck(env, checkId, trigger)` —
      HTTP check via `fetch()`, TCP check via `cloudflare:sockets`' `connect()` (research.md §2),
      writes a `check_runs` row, updates `checks`' `consecutive_failures`/`consecutive_successes`/
      `status` (incident logic deferred to User Story 2; webhook logic deferred to User Story 4)
      (depends on T007)
- [x] T010 [US1] Wire the real uptime case into `worker/index.ts`'s `scheduled()` handler: query
      `checks` for due rows (`next_run_at <= now`), call `runCheck(env, id, "scheduled")` for each,
      update `next_run_at = now + interval_seconds` (depends on T009, T004, T003)
- [x] T011 [US1] Implement `POST /api/internal/checks` (with `interval_seconds >= 60` and
      20-checks-per-project validation, research.md §4), `GET /api/internal/checks`, and
      `GET /api/internal/checks/:id` in `worker/modules/uptime/routes.ts` per
      contracts/uptime-internal-api.md (depends on T003)
- [x] T012 [US1] Wire the real `uptimeRoutes` into `worker/index.ts` under `/api/internal`,
      replacing T005's stub (depends on T011, T005)
- [x] T013 [P] [US1] Create `app/shell/UptimeScreen.tsx`'s real check list and creation form
      (replacing Module 1's static empty state) (depends on T012)
- [x] T014 [US1] Run T007-T008's tests, confirm all pass (depends on T009-T012)

**Checkpoint**: Checks run on schedule and correctly report status.

---

## Phase 4: User Story 2 - Get notified once when something breaks (Priority: P1)

**Goal**: Consecutive failures open exactly one incident; consecutive recoveries auto-resolve it.

**Independent Test**: quickstart.md's "Validate User Story 2" — drive a check past its failure
threshold, confirm exactly one incident opens and stays open through further failures; drive it past
the recovery threshold, confirm auto-resolution.

**Depends on**: User Story 1 (`runCheck()` and `checks` must exist).

### Tests for User Story 2

- [x] T015 [P] [US2] Write a unit test for the incident open/resolve transition logic within
      `runCheck()` (reaching `failure_threshold` opens exactly one incident; further consecutive
      failures do NOT open a second one; reaching `recovery_threshold` resolves the open incident;
      isolated failures below threshold open nothing) — expect it to fail until T016 lands

### Implementation for User Story 2

- [x] T016 [US2] Extend `worker/modules/uptime/evaluate.ts`'s `runCheck()` with incident open/
      resolve logic (writes/updates `incidents` rows per data-model.md's state transitions) (depends
      on T015, T009)
- [x] T017 [US2] Implement `GET /api/internal/incidents` in `worker/modules/uptime/routes.ts` per
      contracts/uptime-internal-api.md (depends on T016, T012)
- [x] T018 [P] [US2] Create `app/shell/AlertsScreen.tsx`'s real incident list (replacing Module 1's
      static empty state), linking each to its originating check (depends on T017)
- [x] T019 [US2] Run T015's test, confirm it passes (depends on T016)

**Checkpoint**: Incidents open/resolve correctly, without alert-spamming during an ongoing outage.

---

## Phase 5: User Story 3 - Test a check right now (Priority: P2)

**Goal**: A manually-triggered check uses the identical evaluation a scheduled run would —
constitution Principle V's shared-evaluation-logic requirement, proven by construction.

**Independent Test**: quickstart.md's "Validate User Story 3" — trigger a check manually, confirm
the result and any resulting state change matches what an equivalent scheduled run would produce.

**Depends on**: User Story 1 (`runCheck()` must exist). Independent of User Story 2 (though the
proof test also exercises incident-transition parity if run against a check with configured
thresholds).

### Tests for User Story 3

- [x] T020 [P] [US3] Write `tests/unit/uptime-shared-path.test.ts` — constitution Principle V's
      proof-by-construction (research.md §8): asserts both the scheduled cron case (T010) and the
      new interactive trigger route (T021) invoke the identical exported `runCheck` function (not
      two separately-implemented paths that merely behave similarly), and that identical check
      configurations produce identical resulting state regardless of which `trigger` value is passed
      — expect it to fail until T021 lands

### Implementation for User Story 3

- [x] T021 [US3] Implement `POST /api/internal/checks/:id/trigger` in
      `worker/modules/uptime/routes.ts`, calling `runCheck(env, id, "interactive")` — the SAME
      function T010's scheduled case calls, not a reimplementation — per
      contracts/uptime-internal-api.md (depends on T020, T012)
- [x] T022 [P] [US3] Create `app/shell/CheckDetailScreen.tsx` (run history, incidents, a "test this
      check now" button) and wire list→detail navigation from `UptimeScreen.tsx` (depends on T021)
- [x] T023 [US3] Run T020's test, confirm it passes (depends on T021)

**Checkpoint**: Constitution Principle V's requirement is honored and proven, not just asserted.

---

## Phase 6: User Story 4 - Get notified outside the dashboard (Priority: P3)

**Goal**: An incident open/resolve fires exactly one webhook request each, without ever blocking or
corrupting the underlying incident record.

**Independent Test**: quickstart.md's "Validate User Story 4" — configure a webhook, drive an
incident open then resolved, confirm exactly one request each.

**Depends on**: User Story 2 (webhooks fire on the incident transitions it introduces).

### Tests for User Story 4

- [x] T024 [P] [US4] Write a unit test for webhook payload construction and fire-and-forget behavior
      (a failing/unreachable webhook `fetch()` does not throw out of `runCheck()` or prevent the
      incident record from being correctly written, per spec FR-011) — expect it to fail until T025
      lands

### Implementation for User Story 4

- [x] T025 [US4] Extend `runCheck()`'s incident open/resolve logic to POST to `checks.webhook_url`
      when set — single attempt, short timeout, no retry (research.md §7) (depends on T024, T016)
- [x] T026 [P] [US4] Add a webhook URL field to the check creation/edit form
      (`UptimeScreen.tsx`/`CheckDetailScreen.tsx`) (depends on T025, T013)
- [x] T027 [US4] Run T024's test, confirm it passes (depends on T025)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T028 Extend `worker/modules/ingest/retention.ts` to prune `check_runs` rows past their own
      30-day window (research.md §5), on the same `scheduled()` cron trigger — `checks`/`incidents`
      are NOT pruned (data-model.md)
- [x] T029 [P] Write a unit test for the `check_runs` retention query logic, mirroring
      `tests/unit/retention.test.ts`'s existing pattern
- [x] T030 Implement `PATCH /api/internal/checks/:id` and `DELETE /api/internal/checks/:id` in
      `worker/modules/uptime/routes.ts` — delete auto-resolves any open incident for that check as
      part of the same operation (research.md §6); both write `audit_log` (constitution Principle X)
      (depends on T012, T016)
- [x] T031 [P] Extend `tests/contract/uptime-checks.spec.ts` with webhook-delivery coverage (a
      request-capturing test endpoint the contract test controls)
- [x] T032 [P] Write `tests/e2e/uptime-and-alerts.spec.ts` — check creation, manual trigger, and
      incident visibility across the Uptime and Alerts screens
- [x] T033 [P] Run `deno fmt` and `deno lint` across `worker/`, `app/`, `tests/`; fix violations
- [x] T034 [P] Run `deno check` (typecheck) across every new/changed `.ts`/`.tsx` file
- [x] T035 Run the full `quickstart.md` validation end-to-end (all four user stories) and record
      results
- [x] T036 Update `README.md`'s Status section to reference `specs/006-uptime-monitoring`; document
      the new `triggers.crons` entry and note the single-region deviation from the constitution's
      original "multi-region" wording explicitly (plan.md's Complexity Tracking)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on User Story 1 (`runCheck()`/`checks` must exist).
- **User Story 3 (Phase 5)**: Depends on User Story 1 only. Independent of User Story 2.
- **User Story 4 (Phase 6)**: Depends on User Story 2 (webhooks fire on the incident transitions it
  introduces).
- **Polish (Phase 7)**: Depends on all four user stories.

### Parallel Opportunities

- Setup: T001 alone.
- Foundational: T002→T003 sequential (migration then apply); T004, T005 can proceed in parallel once
  T001 lands; T006 after all.
- Within US1: T007 alone before T009; T008 (contract test) can be written in parallel with T007, but
  both fail until T009-T012 land.
- User Story 2 and User Story 3 can proceed in parallel with each other once User Story 1 is
  complete (neither depends on the other).
- Within US2: T015 alone before T016.
- Within US3: T020 alone before T021.
- Within US4: T024 alone before T025.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Setup + Foundational
2. User Story 1
3. **STOP and VALIDATE**: run quickstart.md's User Story 1 validation
4. This alone proves the core "configure a check, see real status" promise.

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → validate independently → checks run and report status (MVP)
3. Add US2 and US3 in either order (both depend only on US1) → validate each independently
4. Add US4 (depends on US2) → validate independently
5. Polish → `check_runs` retention in place, check edit/delete complete, fmt/lint/typecheck clean,
   README documents the single-region deviation explicitly

### Notes

- Unlike every prior module, this module carries a real, documented constitution deviation
  (single-region, not multi-region) — plan.md's Complexity Tracking table is not empty here, and
  T036 ensures the deviation is visible in README, not just buried in `specs/`.
- T020's Principle V proof-by-construction test is this module's single most important test —
  everything else in this module could work correctly while still violating the constitution's
  actual requirement if the scheduled and interactive paths secretly diverged; T020 is what catches
  that.
- Tests are written first within each story's phase and are expected to fail until that story's
  implementation tasks land (constitution Principle VIII).

---

## Phase 8: Convergence

- [x] T037 CRITICAL: Add contract-test coverage (against a real `wrangler dev`, where
      `cloudflare:sockets` actually resolves) proving a TCP check via `runTcpCheck()`/`runCheck()`
      correctly reports `up` for a reachable `host:port` and `down` for an unreachable one — no test
      (unit, contract, or e2e) currently exercises the TCP code path at all, despite T007/T008 both
      explicitly calling for it and both being marked `[x]` per US1/AC3 (Constitution VIII)
      (missing)
- [x] T038 Wire `worker/modules/uptime/evaluate.ts`'s `runCheck()` to actually call
      `worker/modules/uptime/decide.ts`'s `applyOutcome()` for its consecutive-failure/recovery
      threshold decision (currently duplicated inline as a separate hand-written SQL `CASE`
      expression that `decide.ts`'s own file-header comment falsely claims is the caller), or
      otherwise resolve the discrepancy so `tests/unit/uptime-decide.test.ts` exercises the logic
      that actually runs in production, not a parallel copy that could silently diverge from it per
      plan.md's Testing section (contradicts)
- [x] T039 Update `app/shell/AlertsScreen.tsx`'s empty-state copy (currently the leftover Module 1
      placeholder "No alert rules yet" / "Alert rules will show up here once your workspace has data
      to evaluate them against") to describe uptime incidents, this module's actual concept, per
      FR-009/US2/AC4 (partial)
- [x] T040 `worker/modules/uptime/create-check.ts`'s shared `createCheck()` helper enforces
      `MAX_CHECKS_PER_PROJECT` internally, but did not enforce `MIN_INTERVAL_SECONDS` itself — that
      floor was independently re-validated in `routes.ts`'s `POST /checks` and `PATCH /checks/:id`
      handlers, and `default-checks.ts`'s seeding path (issue #72) called `createCheck()` directly,
      only happening to comply because it hardcodes `60`, with nothing in the shared helper itself
      to catch a future caller that passed a bad interval. Moved the `MIN_INTERVAL_SECONDS` check
      into `createCheck()` itself (alongside `MAX_CHECKS_PER_PROJECT`), returning a new
      `"interval-too-low"` sentinel following the same convention as `"limit-reached"`; removed the
      now-redundant pre-check from `POST /checks` (which routes through `createCheck()`); left
      `PATCH /checks/:id`'s own check in place since PATCH updates in place and never calls
      `createCheck()` (contradicts)
