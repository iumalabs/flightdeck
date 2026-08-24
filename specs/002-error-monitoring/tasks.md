---

description: "Task list for Error Monitoring"

---

# Tasks: Error Monitoring

**Input**: Design documents from `/specs/002-error-monitoring/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution Principle VIII requires tests before a feature is done; this
module's highest-risk logic (fingerprinting, envelope parsing, DSN auth, source-map resolution) is
pure-function-testable and gets unit coverage first, with contract tests against a real `wrangler
dev` for wire-format correctness (research.md's testing rationale) and Playwright for the UI flow.

**Organization**: Tasks are grouped by user story (US1–US4, matching spec.md's priorities). This
module has more inherent story-to-story sequencing than Module 1 did — US2 needs US1's data to
exist, US3 modifies US1's ingest pipeline's fingerprinting step, US4 extends US2's issue detail
response — each dependency is called out explicitly rather than assumed.

**⚠️ Status**: Planned, not yet authorized for implementation — see plan.md's Summary. Do not begin
executing these tasks without a separate explicit go-ahead.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- File paths are relative to the repository root

## Path Conventions

Extends Module 1's `worker/` (Hono API) + `app/` (React SPA) + `tests/` (unit + contract + e2e)
layout — see plan.md's Structure Decision for the two additions (`worker/durable-objects/`,
`tests/contract/`).

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Add `@jridgewell/trace-mapping` to `deno.json`'s import map
- [X] T002 [P] Create directory skeleton: `worker/durable-objects/`, `worker/modules/ingest/`,
      `worker/modules/issues/`, `worker/modules/github/`, `tests/contract/`
- [X] T003 Add `SOURCE_MAPS` R2 bucket binding and `RATE_LIMITER` Durable Object binding to
      `wrangler.jsonc` (both `env.production` and `env.preview`, per Module 1's symmetric-envs
      pattern); add `GITHUB_APP_ID` var and `GITHUB_APP_PRIVATE_KEY` to `secrets.required` (both
      envs) per research.md §10

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, bindings wiring, and the ingest-vs-internal routing split every user story
needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Create `worker/db/migrations/0002_error_monitoring.sql` — `projects.dsn_public_key`
      column (backfill the existing `demo` project with a generated key), `issues`, `events`,
      `releases`, `source_maps`, `repository_connections` tables per data-model.md, with the
      `UNIQUE` constraints data-model.md specifies (`issues(project_id, fingerprint)`,
      `events(project_id, sdk_event_id)`, `releases(project_id, version)`)
- [X] T005 Apply the migration locally: `deno task db:migrations:apply:local` (depends on T004)
- [X] T006 Create `worker/durable-objects/rate-limiter.ts` — `RateLimiter` DO class skeleton (one
      instance per DSN key via `idFromName`), `checkAndIncrement()` method returning
      allowed/retry-after, no HTTP handler logic yet beyond what the class needs to be a valid DO
      (depends on T003)
- [X] T007 Wire the ingest route mount point into `worker/index.ts`: register
      `app.route("/api/:projectId/envelope", ingestRoutes)` (empty router for now) as a sibling to
      the existing `app.route("/api/internal", identityRoutes)`, and add the `internal` reserved-
      project-id guard at the top of the (still-empty) ingest handler per research.md §3 (depends
      on T002)
- [X] T008 [P] Add a `scheduled()` handler to `worker/index.ts`'s default export (Module 1 only had
      `fetch()`) — no-op body for now, wired to a daily Cron Trigger entry in `wrangler.jsonc`
      (both envs) — this is what T0XX's retention job (Polish phase) will fill in later, added now
      because it's a `wrangler.jsonc`/`worker/index.ts` shape change every later task should build
      on top of, not retrofit
- [X] T009 Verify `deno task build` and `deno check` still pass with the new bindings/tables/empty
      routes wired in (smoke check, no new files)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - See production errors as grouped issues (Priority: P1) 🎯 MVP

**Goal**: A real `@sentry/browser`-family SDK and a real `sentry-sdk` (Python) instance, pointed at
a project's DSN, both produce grouped issues visible in the dashboard.

**Independent Test**: quickstart.md's "Validate User Story 1" — real SDKs (or hand-crafted envelope
bodies per the contract-level alternative) against a running `wrangler dev`, confirming grouping,
event-count increment, and DSN-auth/rate-limit rejection.

### Tests for User Story 1

- [X] T010 [P] [US1] Write `tests/unit/dsn-auth.test.ts` (resolves a valid `sentry_key` from either
      the header or query-string form per research.md §1; rejects missing/unknown/mismatched keys;
      rejects `project_id: "internal"` outright) — expect it to fail until T014 lands
- [X] T011 [P] [US1] Write `tests/unit/envelope.test.ts` (parses a well-formed multi-item envelope,
      extracts `event`-type items, correctly skips unrecognized item types using their `length`
      header per research.md §2, rejects a malformed/truncated envelope without throwing
      unhandled) — expect it to fail until T015 lands
- [X] T012 [P] [US1] Write `tests/unit/fingerprint.test.ts` (explicit `fingerprint` field wins;
      stacktrace-based grouping for events with a stack trace; message-based fallback for
      stack-trace-less events; two events with identical stack shape produce the same fingerprint)
      — expect it to fail until T016 lands
- [X] T013 [P] [US1] Write `tests/contract/ingest-envelope.spec.ts` (against real `wrangler dev`:
      hand-crafted envelope bodies matching contracts/ingest-api.md for both a JS-shaped and a
      Python-shaped event payload; asserts `200` + resulting issue/event rows; asserts `403` for a
      bad DSN key; asserts `429` + `X-Sentry-Rate-Limits` header format once past the rate limit)
      — expect it to fail until T017-T019 land

### Implementation for User Story 1

- [X] T014 [P] [US1] Implement DSN resolution in `worker/modules/ingest/routes.ts`'s auth helper
      (header + query-string, per contracts/ingest-api.md) (depends on T010, T005)
- [X] T015 [P] [US1] Implement `worker/modules/ingest/envelope.ts` — envelope grammar parser per
      research.md §2 (depends on T011)
- [X] T016 [P] [US1] Implement `worker/modules/ingest/fingerprint.ts` — pure functions per
      research.md §5 (explicit → stacktrace → message order); include a `resolveSourceMap` call
      site in the pipeline's intended position (before fingerprinting) that calls a stub
      (`worker/modules/ingest/sourcemap.ts` exporting a function that always returns "no
      resolution" for now — User Story 3 fills in the real implementation without needing to
      rewire this call site) (depends on T012)
- [X] T017 [US1] Implement `POST /api/:projectId/envelope/` in `worker/modules/ingest/routes.ts`:
      rate-limit check (T006's DO) → DSN auth (T014) → envelope parse (T015) → per `event` item:
      dedupe on `(project_id, sdk_event_id)`, fingerprint (T016), upsert `issue`, insert `event`
      (depends on T014, T015, T016, T006, T007)
- [X] T018 [P] [US1] Implement `GET /api/internal/issues` in `worker/modules/issues/routes.ts`,
      gated by `sessionAuth` (mirrors Module 1's `identityRoutes` pattern) (depends on T005)
- [X] T019 [US1] Wire `issuesRoutes` into `worker/index.ts` under `/api/internal/issues` (depends
      on T018)
- [X] T020 [US1] Replace `app/shell/IssuesScreen.tsx`'s static empty state with a real list backed
      by `GET /api/internal/issues` (title/culprit/level/event count columns, per contracts/
      internal-api.md), keeping an honest "No issues yet" state when the list is genuinely empty
      (depends on T019)
- [X] T021 [US1] Run T010-T013's tests, confirm all pass (depends on T014-T020)

**Checkpoint**: A real SDK's error reliably becomes a visible, correctly-grouped issue.

---

## Phase 4: User Story 2 - Diagnose an issue from its detail view (Priority: P2)

**Goal**: Clicking an issue shows its full stack trace, breadcrumbs, and tags/context.

**Independent Test**: quickstart.md's "Validate User Story 2" — fetch a real ingested issue's
detail and confirm stack trace/breadcrumbs/context are present and correctly attributed.

**Depends on**: User Story 1 (there must be real ingested issues to view).

### Tests for User Story 2

- [X] T022 [P] [US2] Write a unit test for the issue-detail response shaping (stack trace frame
      mapping, breadcrumb ordering) in `tests/unit/issue-detail.test.ts` — expect it to fail until
      T023 lands

### Implementation for User Story 2

- [X] T023 [US2] Implement `GET /api/internal/issues/:id` in `worker/modules/issues/routes.ts` per
      contracts/internal-api.md (stack trace, breadcrumbs, tags/context from the latest event;
      `suspectCommit: null` for now — User Story 4 fills this in) (depends on T019, T022)
- [X] T024 [P] [US2] Create `app/shell/IssueDetailScreen.tsx` — stack trace, breadcrumbs,
      tags/context display
- [X] T025 [US2] Add `selectedIssueId` state to `app/shell/AppShell.tsx` (research.md §11); wire
      clicking an issue in `IssuesScreen.tsx` to set `screen: "issue-detail"` +
      `selectedIssueId`; route to `IssueDetailScreen` (depends on T020, T024)
- [X] T026 [US2] Run T022's test, confirm it passes (depends on T023)

**Checkpoint**: Issues are independently diagnosable from their detail view.

---

## Phase 5: User Story 3 - Read original source instead of minified code (Priority: P2)

**Goal**: An uploaded source map resolves minified stack frames to original source, and grouping
uses the resolved trace.

**Independent Test**: quickstart.md's "Validate User Story 3" — ingest a minified-trace error,
upload its source map, confirm the issue's stack trace resolves without re-triggering the error.

**Depends on**: User Story 1 (ingest pipeline's fingerprinting call site, T016) and User Story 2
(the detail view that displays the resolved trace).

### Tests for User Story 3

- [X] T027 [US3] **Spike (blocking)**: prove `@jridgewell/trace-mapping` loads and correctly
      resolves a real, hand-constructed Source Map v3 mapping string inside `wrangler dev` per
      research.md §6. Record the outcome in research.md — either confirm the decision or replace
      it with the documented fallback (hand-rolled VLQ decoder) before any task below starts
- [X] T028 [P] [US3] Write `tests/unit/sourcemap-resolve.test.ts` (resolves a minified
      `(line, column)` to the correct original `(source, line, column, name)` against a real Source
      Map v3 fixture; returns "no resolution" gracefully for a release with no uploaded map) —
      expect it to fail until T029 lands (depends on T027)
- [X] T029 [P] [US3] Write a contract test for the upload endpoint in
      `tests/contract/source-map-upload.spec.ts` (against real `wrangler dev`: uploads a map,
      confirms it lands in R2 + `source_maps` metadata; uploading for a not-yet-seen release
      implicitly creates the release per the Edge Case in spec.md) — expect it to fail until T031
      lands

### Implementation for User Story 3

- [X] T030 [US3] Implement real resolution in `worker/modules/ingest/sourcemap.ts` using the
      library/approach T027's spike confirmed, replacing US1's stub (depends on T027, T028, T016)
- [X] T031 [US3] Implement `POST /api/internal/projects/:id/source-maps` per contracts/internal-
      api.md (multipart upload → R2 write → `source_maps` + implicit `releases` row → `audit_log`
      entry per constitution Principle X) (depends on T029, T005)
- [X] T032 [US3] Confirm the ingest pipeline (T017) calls T030's real resolution before
      fingerprinting (research.md §5's ordering) — this should already be correct by construction
      since T016 built the call site in the right place; this task is the explicit verification,
      not a rewire (depends on T030, T017)
- [X] T033 [US3] Update `app/shell/IssueDetailScreen.tsx` to show resolved (vs. raw) frame
      indicators (depends on T024, T032)
- [X] T034 [US3] Add a minimal source map upload UI (form: release, path pattern, file) — extend
      `app/shell/SettingsScreen.tsx` per plan.md's Structure Decision, not a new dedicated screen
      (depends on T031)
- [X] T035 [US3] Run T028-T029's tests, confirm both pass (depends on T030-T034)

**Checkpoint**: Minified JS stack traces resolve to real source, and cross-build grouping is
correct.

---

## Phase 6: User Story 4 - See who likely caused an issue (Priority: P3)

**Goal**: A connected GitHub repository surfaces a suspect commit on qualifying issues.

**Independent Test**: quickstart.md's "Validate User Story 4" — connect a real test repository,
confirm the suspect commit shown matches the actual most recent commit touching the culprit file.

**Depends on**: User Story 2 (the issue detail response this extends with `suspectCommit`).

### Tests for User Story 4

- [X] T036 [P] [US4] Write `tests/unit/github-app-auth.test.ts` (signs a valid App JWT from a test
      private key; the installation-token exchange call shape matches research.md §10 — mock the
      GitHub API boundary, don't hit the real network in a unit test) — expect it to fail until
      T037 lands

### Implementation for User Story 4

- [X] T037 [US4] Implement `worker/modules/github/app-auth.ts` — App JWT signing (via the existing
      `jose` dependency) + installation-access-token exchange, per research.md §10's exact flow
      (never persists the resulting token) (depends on T036, T003)
- [X] T038 [US4] Implement `POST /api/internal/projects/:id/github/connect` and
      `DELETE /api/internal/projects/:id/github` in `worker/modules/github/routes.ts` per
      contracts/internal-api.md, including `audit_log` entries on both connect and disconnect
      (constitution Principle X) (depends on T037, T005)
- [X] T039 [US4] Implement the suspect-commit lookup (`GET /repos/{owner}/{repo}/commits?
      path={file}` via T037's on-demand token) and wire it into `GET /api/internal/issues/:id`'s
      `suspectCommit` field (currently `null` per T023), returning `null` (not an error) when no
      repo is connected, the file isn't found, or the credential exchange fails (spec FR-011)
      (depends on T037, T023)
- [X] T040 [US4] Add a "Connect GitHub" UI (installation-flow entry point + connected-repo display)
      to `app/shell/SettingsScreen.tsx` (depends on T038)
- [X] T041 [US4] Update `app/shell/IssueDetailScreen.tsx` to show the suspect commit when present
      (depends on T024, T039)
- [X] T042 [US4] Run T036's test, confirm it passes (depends on T037-T041)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T043 Implement `worker/modules/ingest/retention.ts` and wire it into T008's `scheduled()`
      handler — deletes `events` rows older than the default window (90 days) without touching
      their owning `issues` row's summary fields (constitution Principle IX, spec FR-015)
- [X] T044 [P] Write a unit test for the retention job's query logic (prunes old events, preserves
      issue rows and their summary fields) in `tests/unit/retention.test.ts`
- [X] T045 [P] Write `tests/e2e/issues-list-and-detail.spec.ts` — pre-authenticated context (Module
      1's pattern) plus seeded D1 data, covering navigation from the issues list into an issue's
      detail
- [X] T046 [P] Run `deno fmt` and `deno lint` across `worker/`, `app/`, `tests/`; fix violations
- [X] T047 [P] Run `deno check` (typecheck) across every new/changed `.ts`/`.tsx` file
- [X] T048 Run the full `quickstart.md` validation end-to-end (all four user stories) and record
      results
- [X] T049 Update `README.md`'s Status section to reference `specs/002-error-monitoring`; document
      the new `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` secrets in the Environment table

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on User Story 1 (needs real issues to exist).
- **User Story 3 (Phase 5)**: Depends on User Story 1 (the fingerprinting call site) and User
  Story 2 (the detail view it updates) — genuinely cross-cutting, not independently deliverable
  before both exist.
- **User Story 4 (Phase 6)**: Depends on User Story 2 (the issue detail response it extends).
- **Polish (Phase 7)**: Depends on all four user stories.

### Parallel Opportunities

- Setup: T001, T002 in parallel; T003 after T002.
- Foundational: T004→T005 sequential (migration then apply); T006, T007, T008 can proceed in
  parallel with each other once T002/T003/T005 land.
- Within US1: T010-T013 (tests) in parallel; T014, T015, T016 in parallel (different files) once
  their respective tests exist; T017 depends on all three.
- Within US3: T027 (spike) blocks T028 and everything after it — it is NOT parallelizable with the
  rest of the phase, unlike most `[P]` task groups elsewhere in this file.
- Within US4: T036 alone before T037; T038/T039 can proceed in parallel once T037 lands.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Setup + Foundational
2. User Story 1
3. **STOP and VALIDATE**: run quickstart.md's User Story 1 validation against real SDKs
4. This alone proves the core "point an SDK at a DSN, see grouped issues" promise

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → validate independently → ingest + grouping works (MVP)
3. Add US2 → validate independently → issues are diagnosable
4. Add US3 → validate independently → minified JS traces resolve, cross-build grouping correct
5. Add US4 → validate independently → suspect commits appear
6. Polish → retention job in place (constitution Principle IX compliance), fmt/lint/typecheck
   clean, README current

### Notes

- This module's user stories are more sequentially dependent than Module 1's — that's an accurate
  reflection of the feature (an issue detail view has nothing to show without ingest, source-map
  resolution has nothing to resolve without both), not a process shortcut.
- Tests are written first within each story's phase and are expected to fail until that story's
  implementation tasks land (constitution Principle VIII).
- T027 (the source-map library spike) is the one task in this file that must run alone, not in
  parallel with sibling `[P]` tasks — everything in User Story 3 depends on its outcome, including
  which library ends up implemented in T030.

---

## Phase 8: Convergence

- [ ] T050 Distinguish "no stack trace/breadcrumbs were ever recorded" from "this issue's only
      occurrence(s) aged out under retention" in `GET /api/internal/issues/:id`
      (`worker/modules/issues/routes.ts`) and surface the latter case explicitly in
      `app/shell/IssueDetailScreen.tsx` (e.g. "Detailed event data is no longer retained for this
      issue" instead of the current, identical-either-way "No stack trace recorded for this
      event." / "No breadcrumbs recorded." text) per spec.md's Edge Case "An issue's only recorded
      occurrence ages past the retention window" / FR-015 (partial)
- [ ] T051 Add a test asserting the ingest endpoint rejects an oversized envelope body with `413`
      (`MAX_ENVELOPE_BYTES` in `worker/modules/ingest/routes.ts`) — no unit, contract, or e2e test
      currently exercises this path despite contracts/ingest-api.md explicitly naming it as part of
      the ingest contract, per FR-013 / contracts/ingest-api.md line 33 / Constitution Principle
      VIII (partial)
