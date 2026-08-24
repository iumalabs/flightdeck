---

description: "Task list for User Feedback"

---

# Tasks: User Feedback

**Input**: Design documents from `/specs/007-user-feedback/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution Principle VIII requires tests before a feature is done; this
module's highest-risk logic is the crash-report dialog's wire shape (research.md §1's confirmed,
non-obvious contract — query param names, POST field names, upsert-on-retry behavior) and the
`associated_event_id` → `issue_id` resolution shared by both ingest paths.

**Organization**: Tasks are grouped by user story (US1-US3, matching spec.md's priorities: US1=P1,
US2=P1, US3=P2). US1 (widget/envelope) and US2 (crash-report dialog) are independent ingest paths
sharing only the Foundational schema and a resolution helper; US3 (issue-detail cross-linking)
depends on both, since it surfaces `issue_id` values either path can populate.

**Status**: Implemented and verified — all 27 tasks complete. `deno fmt`/`deno lint`/`deno check`
clean; 16 new unit tests (`resolveIssueId`/`insertWidgetFeedback` dedup logic, `parseDsn`,
`buildDialogScript`) all pass; 9 new contract tests against a real `wrangler dev` (envelope path's
valid/invalid-DSN/missing-message/dedup cases, dialog GET's valid/malformed-dsn/missing-eventId
cases, dialog POST's linked-upsert/missing-comments cases) all pass; 2 new e2e tests pass, including
a genuine SC-002-grade validation that loads the real, unmodified `@sentry/browser` UMD bundle from
its actual CDN in a live browser and drives `Sentry.showReportDialog()` end to end against this
module's endpoint — not just a hand-crafted approximation of the real SDK's request shape. Two test-
fixture bugs (not application bugs — the underlying ingest/upsert logic was correct both times) were
found and fixed during live contract testing — see research.md §6. **This was the last module in the
constitution's Product Scope & Module Roadmap** — all seven modules are now implemented.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

## Path Conventions

Extends Modules 1-6's `worker/` (Hono API) + `app/` (React SPA) + `tests/` (unit + contract + e2e)
layout — see plan.md's Structure Decision. No new top-level directories, no new Cloudflare bindings,
no `wrangler.jsonc` change (research.md §2).

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [P] Create directory skeleton: `worker/modules/feedback/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema and routing scaffolding every user story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Create `worker/db/migrations/0007_user_feedback.sql` — `feedback` table per
      data-model.md, including the `(project_id, received_at)` and `(issue_id)` indexes and the
      unique `(project_id, associated_event_id, source)` constraint scoped to
      `source = 'crash_report_dialog'` rows (research.md §1's confirmed upsert behavior)
- [x] T003 Apply the migration locally: `deno task db:migrations:apply:local` (depends on T002)
- [x] T004 Mount an empty, `sessionAuth`-gated `feedbackRoutes` router under `/api/internal` in
      `worker/index.ts` (depends on T001)
- [x] T005 Verify `deno task build` and `deno check` still pass with the new table/empty routes
      wired in (smoke check, no new business-logic files)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Collect feedback from anywhere in the app (Priority: P1) 🎯 MVP

**Goal**: A standard SDK's feedback widget, pointed at a project's DSN, results in feedback visible
in FlightDeck's dashboard — standalone or linked, both as normal cases.

**Independent Test**: quickstart.md's "Validate User Story 1" — hand-crafted envelope POST with a
`"feedback"` item, confirm it appears in `GET /api/internal/feedback`; confirm an invalid DSN key is
rejected with nothing recorded.

### Tests for User Story 1

- [x] T006 [P] [US1] Write `tests/unit/feedback-ingest.test.ts` (envelope `"feedback"` item
      parsing/dispatch; `associated_event_id` → `issue_id` resolution against `events.sdk_event_id`,
      both the found and not-found cases per FR-006; dedup by the item's own `event_id` against
      `feedback.sdk_event_id`) — expect it to fail until T008-T009 land
- [x] T007 [US1] Write `tests/contract/feedback-api.spec.ts`'s envelope-path cases (against real
      `wrangler dev`: POST a feedback envelope item with a valid DSN and confirm it's recorded;
      repeat with an invalid/unknown DSN and confirm `403` with nothing recorded per FR-002; POST
      one with no `associated_event_id` and confirm it's recorded standalone per Acceptance
      Scenario 3) — expect it to fail until T008-T012 land

### Implementation for User Story 1

- [x] T008 [US1] Add `isFeedbackItem()` to `worker/modules/ingest/envelope.ts`, mirroring the
      existing `isEventItem()` (depends on T006)
- [x] T009 [US1] Implement `worker/modules/feedback/ingest.ts` — the shared write path: parse
      `contexts.feedback` (message required; name/contact_email/url/associated_event_id optional,
      per contracts/feedback-ingest-api.md), resolve `associated_event_id` against
      `events.sdk_event_id` scoped to the project to derive `issue_id`, dedup on the item's own
      `event_id` against `feedback.sdk_event_id`, insert with `source = 'widget'` (depends on T008,
      T003)
- [x] T010 [US1] Wire `"feedback"` item dispatch into `worker/modules/ingest/routes.ts`'s existing
      per-item loop, calling `feedback/ingest.ts` (depends on T009)
- [x] T011 [US1] Implement `GET /api/internal/feedback` and `GET /api/internal/feedback/:id` in
      `worker/modules/feedback/routes.ts` per contracts/feedback-internal-api.md (depends on T003)
- [x] T012 [US1] Wire the real `feedbackRoutes` into `worker/index.ts` under `/api/internal`,
      replacing T004's stub (depends on T011, T004)
- [x] T013 [P] [US1] Build `app/shell/FeedbackScreen.tsx`'s real list + detail view (replacing
      Module 1's static empty state), fetching from T011's endpoints (depends on T012)
- [x] T014 [US1] Run T006-T007's tests, confirm all pass (depends on T010, T011, T012, T013)

**Checkpoint**: Widget-based feedback ingest works end to end and is visible in the dashboard.

---

## Phase 4: User Story 2 - Ask what happened right after a crash (Priority: P1)

**Goal**: An unmodified SDK's `showReportDialog()` loads FlightDeck's dialog and a submission is
linked to the specific error it was submitted for.

**Independent Test**: quickstart.md's "Validate User Story 2" — GET the dialog endpoint with a real
DSN + event ID and confirm a `text/javascript` response; POST the dialog's form fields to the same
URL and confirm the resulting feedback is linked to that event's issue; repeat the POST and confirm
it upserts rather than duplicating.

### Tests for User Story 2

- [x] T015 [P] [US2] Write `tests/unit/feedback-dialog.test.ts` (dialog GET/POST query-string and
      form-body parsing per contracts/feedback-ingest-api.md; the upsert-on-retry logic keyed on
      `(project_id, associated_event_id, source='crash_report_dialog')`, research.md §1) — expect it
      to fail until T017-T018 land
- [x] T016 [US2] Write `tests/contract/feedback-api.spec.ts`'s dialog-path cases (against real
      `wrangler dev`: GET with a valid `dsn`+`eventId` returns `200`/`text/javascript`; GET with a
      malformed/unresolvable `dsn` returns `404`; GET with no `eventId` returns `400`; POST with
      `name`/`email`/`comments` records feedback linked via `eventId`; a repeated POST for the same
      `eventId` still results in exactly one feedback row) — expect it to fail until T017-T019 land

### Implementation for User Story 2

- [x] T017 [US2] Implement `worker/modules/feedback/dialog.ts`'s GET handler — parse the `dsn` query
      parameter as a full DSN string (not the bare `sentry_key` the envelope path uses) plus
      `eventId`, resolve the project, respond with the self-contained `text/javascript` payload
      (dialog markup + a submit handler posting back to the same URL + the
      `postMessage("__sentry_reportdialog_closed__", ...)` close contract) per research.md §1's
      Decision (depends on T003)
- [x] T018 [US2] Implement `dialog.ts`'s POST handler — parse `name`/`email`/`comments` form body,
      resolve `issue_id` via `events.sdk_event_id = eventId` scoped to the project (reusing T009's
      resolution logic, factored so both paths share it rather than duplicating it), upsert on
      `(project_id, associated_event_id, source='crash_report_dialog')` (depends on T017, T009)
- [x] T019 [US2] Mount `GET|POST /api/embed/error-page` in `worker/index.ts`; confirm live (not just
      by inspection) that it's already reached by the existing `run_worker_first: [..., "/api/*"]`
      wildcard with no `wrangler.jsonc` change (research.md §2) (depends on T017, T018)
- [x] T020 [US2] Run T015-T016's tests, confirm all pass (depends on T017, T018, T019)

**Checkpoint**: The crash-report dialog loads and accepts submissions against an unmodified real
SDK's `showReportDialog()` call, linked to the correct issue.

---

## Phase 5: User Story 3 - Find the feedback tied to a specific issue (Priority: P2)

**Goal**: An issue's own detail view surfaces its linked feedback, present only when non-empty.

**Independent Test**: quickstart.md's "Validate User Story 3" — an issue with linked feedback (from
either US1 or US2) shows it in `GET /api/internal/issues/:id`'s response; an issue with none shows
an empty array and no feedback section renders.

### Tests for User Story 3

- [x] T021 [P] [US3] Write `tests/e2e/feedback-list-and-linking.spec.ts` (an issue with linked
      feedback shows a feedback section on `IssueDetailScreen.tsx`; an issue with none shows no
      section at all, per Acceptance Scenario 2) — expect it to fail until T022-T023 land

### Implementation for User Story 3

- [x] T022 [US3] Add a `feedback` array field to the existing `GET /api/internal/issues/:id` (Module
      2, `worker/modules/issues/routes.ts`) per contracts/feedback-internal-api.md, querying
      `feedback` by `issue_id` (depends on T009, T018 — both ingest paths must be able to populate
      `issue_id` first)
- [x] T023 [US3] Add a feedback section to `IssueDetailScreen.tsx`, rendered only when the array is
      non-empty (depends on T022)
- [x] T024 [US3] Run T021's test, confirm it passes (depends on T022, T023)

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T025 Run `quickstart.md`'s Real-SDK validation step manually — `@sentry/browser` (>= 7.85.0)
      with `feedbackIntegration()` and a real `showReportDialog({ eventId })` call against a local
      `wrangler dev`, confirming SC-002-grade confidence beyond the hand-crafted contract tests
- [x] T026 [P] `deno fmt` / `deno lint` across all new files
- [x] T027 Confirm `deno task test`, `deno task test:contract`, and `deno task test:e2e` all pass
      together as a full suite (not just per-story in isolation)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational only — independent of US1's implementation,
  though T018 factors its issue-resolution logic to share T009's helper rather than duplicate it.
- **User Story 3 (Phase 5)**: Depends on BOTH US1 (T009) and US2 (T018) — it surfaces `issue_id`
  values either ingest path can populate.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Parallel Opportunities

- T001 (Setup) has no dependencies.
- Once Foundational (Phase 2) completes, US1 (Phase 3) and US2 (Phase 4) can proceed in parallel —
  they touch disjoint files (`feedback/ingest.ts` vs. `feedback/dialog.ts`) until US3 needs both.
- Within US1: T006 and T007 (tests) in parallel; T013 (frontend) in parallel with backend work once
  T012 lands.
- Within US2: T015 and T016 (tests) in parallel.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1 (widget-based feedback).
4. **STOP and VALIDATE**: widget feedback appears in the dashboard, standalone and linked.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → widget feedback works (MVP).
3. User Story 2 → crash-report dialog works, independent of US1's own completion.
4. User Story 3 → issue-detail cross-linking, the one story genuinely dependent on both prior ones.
5. Polish → real-SDK validation, full-suite confirmation.

---

## Phase 7: Convergence

- [x] T028 Apply the existing per-DSN-key `RATE_LIMITER` check to the crash-report dialog's GET and
      POST handlers (`worker/modules/feedback/dialog.ts` `handleDialogGet`/`handleDialogPost`,
      mounted directly on `app` in `worker/index.ts` with no limiter in between) so
      `/api/embed/error-page` is no longer the one public ingest surface exempt from per-project
      rate limiting per Constitution III (contradicts)
- [x] T029 Enforce a maximum payload size on the crash-report dialog's POST handler
      (`worker/modules/feedback/dialog.ts` `handleDialogPost`, which calls `request.formData()`
      with no size check at all), rejecting oversized `comments`/form bodies consistent with the
      envelope path's `MAX_ENVELOPE_BYTES` posture (`worker/modules/ingest/routes.ts` line ~111)
      per FR-010 (missing)
- [ ] T030 Read the dialog GET's optional `name`/`email` query parameters
      (`worker/modules/feedback/dialog.ts` `handleDialogGet`, which currently reads only `dsn` and
      `eventId`) and thread them into `buildDialogScript`'s rendered form as prefill values, per
      contracts/feedback-ingest-api.md's documented GET contract and research.md §1's confirmed
      real-SDK request shape (`&name={user.name}&email={user.email}`) per plan: dialog GET prefill
      contract (partial)
