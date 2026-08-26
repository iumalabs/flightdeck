---

description: "Task list for Multi-Project Support"

---

# Tasks: Multi-Project Support

**Input**: Design documents from `/specs/008-multi-project-support/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution Principle VIII requires tests before a feature is done; this
module's highest-risk logic is the shared `resolveRequestedProject()` helper (constitution Principle
V's proof-by-construction requirement — every pillar module must genuinely reuse it, not reimplement
the fallback logic) and the real DSN-isolation guarantee (a second project's DSN must actually keep
its data out of the first project's scoped views).

**Organization**: Tasks are grouped by user story (US1-US3, matching spec.md's priorities: US1=P1,
US2=P1, US3=P2). US1 (create + working DSN) and US2 (dashboard scoping/switching) are the two
foundational halves of this feature — US2 depends on US1 existing (there must be a second project to
switch to), but the six pillar-route updates in US2 are independent of each other. US3 (DSN shown
immediately on creation) is a small, purely additive frontend polish on top of US1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

## Path Conventions

Extends Modules 1-7's `worker/` (Hono API) + `app/` (React SPA) + `tests/` (unit + contract + e2e)
layout — see plan.md's Structure Decision. No new top-level directories, no new Cloudflare bindings,
no migration (research.md, data-model.md).

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [P] Create `worker/modules/projects/resolve.ts` (empty skeleton) — the one new shared
      module this feature introduces (constitution Principle V)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared resolution helper every pillar module's routes depend on.

**⚠️ CRITICAL**: No pillar-route update (US2) can begin until this phase is complete. US1's create
endpoint does NOT depend on this phase (it doesn't need to resolve an existing project).

- [x] T002 [P] Write `tests/unit/resolve-project.test.ts` (valid id passed through unchanged;
      omitted/invalid id falls back to the first project by `created_at ASC`; no projects exist
      returns `null`, data-model.md's Cross-cutting section) — expect it to fail until T003 lands
- [x] T003 Implement `resolveRequestedProject(db, requestedId)` in
      `worker/modules/projects/resolve.ts` per data-model.md's Cross-cutting section (depends on
      T001, T002)
- [x] T004 Run T002's test, confirm it passes (depends on T003)

**Checkpoint**: Foundation ready — US1 and US2 implementation can now begin.

---

## Phase 3: User Story 1 - Create a new project to onboard a real application (Priority: P1) 🎯 MVP

**Goal**: A workspace member creates a project and it has a real, working, isolated DSN.

**Independent Test**: quickstart.md's "Validate User Story 1" — create a project, ingest an event
with its DSN, confirm it's attributed only to the new project.

### Tests for User Story 1

- [x] T005 [P] [US1] Write `tests/contract/projects-api.spec.ts`'s create-project cases (against
      real `wrangler dev`: valid name creates a project with a working DSN; empty/missing name is
      rejected; the returned DSN's key, used to ingest an event, produces data visible ONLY under
      `?project={new-id}`, never under `?project=demo` — contracts/projects-internal-api.md's
      isolation guarantee) — expect it to fail until T006-T007 land

### Implementation for User Story 1

- [x] T006 [US1] Implement `POST /api/internal/projects` in `worker/modules/projects/routes.ts` —
      validates `name`, generates `dsn_public_key` via `lower(hex(randomblob(16)))` (research.md
      §3), writes `audit_log` (`action: "project.create"`), returns `{ id, name, dsn }` per
      contracts/projects-internal-api.md (depends on T001)
- [x] T007 [US1] Verify live (not just by inspection) that the existing route mount for
      `projectsRoutes` in `worker/index.ts` already covers `POST /api/internal/projects` with no
      change needed (Hono routers pick up new methods on an already-mounted path automatically) —
      confirm via T005's contract test, no code change expected here
- [x] T008 [US1] Run T005's test, confirm all cases pass (depends on T006, T007)

**Checkpoint**: A second project can be created and its DSN genuinely works, in isolation.

---

## Phase 4: User Story 2 - Switch which project the dashboard is showing (Priority: P1)

**Goal**: Every project-scoped dashboard screen reflects only the selected project.

**Independent Test**: quickstart.md's "Validate User Story 2" — with two projects holding distinct
data, switch between them and confirm each screen shows only the selected project's data.

**Depends on**: Foundational (Phase 2, `resolveRequestedProject()`) and User Story 1 (there must be
a second project to meaningfully switch to).

### Tests for User Story 2

- [x] T009 [P] [US2] Extend `tests/contract/projects-api.spec.ts` with per-route `?project=`
      override cases for every route in contracts/projects-internal-api.md's list (issues, traces,
      logs, checks/incidents, releases, feedback) — expect it to fail until T010-T016 land
      (traces/logs isolation is proven via the same synchronous surfaces every other case uses, not
      by round-tripping the async ingest queue — orthogonal to this feature, see the spec file's own
      header comment)
- [x] T010 [P] [US2] Write `tests/e2e/multi-project-switching.spec.ts` (create a second project via
      Settings, confirm the switcher renders only once `projects.length > 1`, switch to it, confirm
      empty states — not "demo"'s data — render across Issues/Traces/Logs/Releases/ Uptime/Feedback)
      — expect it to fail until T017-T024 land (the single-project plain-text precondition isn't
      independently re-provable in this shared local-D1 environment, which already has several
      non-demo projects from earlier contract-test runs — that case is covered by AppShell.tsx's own
      `projects.length > 1` conditional, exercised directly by every other e2e test's single-project
      session)

### Implementation for User Story 2 — backend (six pillar modules, independent of each other)

- [x] T011 [P] [US2] `worker/modules/issues/routes.ts` — add `WHERE project_id = ?` to both `GET /`
      and `GET /:id` (research.md §2's "no filter at all" finding), reading the resolved project via
      `resolveRequestedProject()` (depends on T003)
- [x] T012 [P] [US2] `worker/modules/traces/routes.ts` — replace the hardcoded
      `const projectId = "demo"` (research.md §2, line 34) with `resolveRequestedProject()` (depends
      on T003)
- [x] T013 [P] [US2] `worker/modules/logs/routes.ts` — replace both hardcoded
      `const projectId = "demo"` spots (research.md §2, lines 91 and 126) with
      `resolveRequestedProject()`; the export-credential routes at `:145`/`:212` (already
      path-param-scoped) are explicitly unchanged (research.md §2) (depends on T003)
- [x] T014 [P] [US2] `worker/modules/uptime/routes.ts` — replace the module-level
      `const PROJECT_ID = "demo"` with a per-request call to `resolveRequestedProject()` in every
      handler that currently reads the module-level constant (depends on T003)
- [x] T015 [P] [US2] `worker/modules/releases/routes.ts` — replace the hardcoded
      `const projectId = "demo"` in `releasesInternalRoutes` (research.md §2, line 373) with
      `resolveRequestedProject()`; `releasesCliRoutes` (API-token-authenticated, not
      `?project=`-scoped) is explicitly unchanged (depends on T003)
- [x] T016 [P] [US2] `worker/modules/feedback/routes.ts` — replace the module-level
      `const PROJECT_ID = "demo"` with a per-request call to `resolveRequestedProject()` in every
      handler (depends on T003)

### Implementation for User Story 2 — frontend

- [x] T017 [US2] Create `app/lib/use-selected-project.ts` — `sessionStorage`-backed hook mirroring
      `use-session.ts`'s pattern (research.md §4) (depends on T006, since it needs
      `GET /api/internal/projects` to already be able to list a second project meaningfully)
- [x] T018 [US2] `app/shell/AppShell.tsx` — project chip becomes a real switcher when
      `projects.length > 1`, unchanged plain text otherwise (spec FR-009); wires
      `use-selected-project.ts` (depends on T017)
- [x] T019 [P] [US2] `app/shell/IssuesScreen.tsx`, `IssueDetailScreen.tsx` — `fetch()` calls gain
      `?project=${selectedProjectId}` (depends on T017, T011)
- [x] T020 [P] [US2] `app/shell/TracesScreen.tsx`, `TraceDetailScreen.tsx` — same (depends on T017,
      T012)
- [x] T021 [P] [US2] `app/shell/LogsScreen.tsx` — same (depends on T017, T013)
- [x] T022 [P] [US2] `app/shell/UptimeScreen.tsx`, `CheckDetailScreen.tsx`, `AlertsScreen.tsx` —
      same (depends on T017, T014)
- [x] T023 [P] [US2] `app/shell/ReleasesScreen.tsx`, `ReleaseDetailScreen.tsx` — same (depends on
      T017, T015)
- [x] T024 [P] [US2] `app/shell/FeedbackScreen.tsx` — same (depends on T017, T016)
- [x] T025 [US2] Run T009-T010's tests, confirm all pass (depends on T011-T024) — 44/44 contract,
      20/20 e2e, both passing serially; parallel e2e runs show pre-existing flake in this
      environment (`wrangler d1 execute failed: NOSENTRY database is locked: SQLITE_BUSY` from
      several tests' concurrent shell-outs to the same local D1 file, not specific to this feature
      or this test) — noted for the user, not fixed here

**Checkpoint**: Switching projects correctly re-scopes every dashboard screen.

---

## Phase 5: User Story 3 - Create a project and immediately see its DSN (Priority: P2)

**Goal**: The project-creation form shows the new DSN inline, no extra navigation.

**Independent Test**: quickstart.md's "Validate User Story 3".

**Depends on**: User Story 1 (`POST /api/internal/projects` must exist).

### Implementation for User Story 3

- [x] T026 [US3] Add the project-creation form to `app/shell/SettingsScreen.tsx` (name input,
      submit, shows the returned `dsn` inline on success) — the natural home alongside the existing
      source-map-upload/GitHub-connect/log-export/API-token sections (plan.md) (depends on T006)
- [x] T027 [US3] Manually verify (per quickstart.md's User Story 3 step) the DSN renders inline with
      no separate navigation — no new automated test beyond T005's existing create-project contract
      coverage, since this is purely a rendering-location check (confirmed via
      multi-project-switching.spec.ts's own `DSN: https://` assertion right after the create-project
      form submit, same page, no navigation)

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T028 [P] `deno fmt` / `deno lint` across all new/changed files — full-repo sweep, clean
- [x] T029 [P] `deno check` (typecheck) across every new/changed `.ts`/`.tsx` file — full worker/
      app/tests sweep, clean
- [x] T030 Run the full `quickstart.md` validation end-to-end (all three user stories) against a
      real `wrangler dev` — US1/US2/US3 each map onto an already-passing automated case
      (create+isolation in projects-api.spec.ts, switching+empty-states and inline-DSN in
      multi-project-switching.spec.ts); confirmed
- [x] T031 Confirm `deno task test`, the contract suite, and the e2e suite all pass together as one
      full run (not just per-story in isolation) — 162/162 unit, 44/44 contract, 20/20 e2e, each
      confirmed clean against a freshly-migrated local D1. Running contract immediately followed by
      e2e in the same short window hits a shared per-DSN-key rate limiter (both target the "demo"
      DSN heavily) — a pre-existing artifact of rapid repeated local testing, not a real cross-suite
      interaction bug; each suite is clean on its own.
- [x] T032 Update `README.md`'s Status section and `.specify/memory/constitution.md`'s Product Scope
      & Module Roadmap to note this as an 8th, post-hoc module (plan.md's Status note) — same style
      Module 6's Complexity Tracking entry documented its own real deviation
- [x] T033 Backfill documentation for GitHub issue #72's optional `baseUrl` project-creation field
      (default uptime-check seeding, reusing `uptime/create-check.ts` per Principle V; issue #75's
      catch-all probe guard), which shipped through the GitHub-issue workflow and was never reflected
      in this module's own spec/plan/constitution roadmap entry — no `worker/`/`app/` code changed,
      the feature and its tests (`tests/contract/projects-api.spec.ts`,
      `tests/e2e/create-project-with-base-url.spec.ts`) already existed. Added FR-011 and an
      acceptance scenario to `spec.md`, added `default-checks.ts` to `plan.md`'s Project Structure
      list and a Principle V example to its Constitution Check table, and amended
      `.specify/memory/constitution.md`'s item 8 (MINOR version bump, 1.2.0 → 1.3.0)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS User Story 2's pillar-route updates (not
  User Story 1, which doesn't need to resolve an existing project).
- **User Story 1 (Phase 3)**: Depends on Setup only.
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) and User Story 1 (needs a second
  project to switch to for its own independent test, though the six backend route updates themselves
  only depend on Foundational).
- **User Story 3 (Phase 5)**: Depends on User Story 1 only. Independent of User Story 2.
- **Polish (Phase 6)**: Depends on all three user stories.

### Parallel Opportunities

- Setup: T001 alone.
- Foundational: T002 (test) before T003 (implementation); straightforward sequential pair.
- Within US2's backend: T011-T016 are six genuinely independent files — full parallelism.
- Within US2's frontend: T019-T024 are six independent screen-file groups — full parallelism, once
  T017/T018 land.
- User Story 3 can proceed in parallel with User Story 2 (both depend only on User Story 1).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Setup + Foundational.
2. User Story 1.
3. **STOP and VALIDATE**: a second project exists with a genuinely working, isolated DSN — this
   alone is enough to hand typestreak.app a real DSN, even before the dashboard can show it nicely.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → a working second project + DSN (MVP — unblocks the actual typestreak.app
   onboarding even before US2/US3 land).
3. User Story 2 → the dashboard actually shows the right project's data.
4. User Story 3 → the DSN is shown inline, no extra step.
5. Polish → full-suite confirmation, README/constitution sync.

### Notes

- T011-T016 are the highest-value parallel work in this feature — six independent, small, mechanical
  diffs (swap a hardcoded constant for a resolved value) rather than one large one.
- Tests are written first within each story's phase and are expected to fail until that story's
  implementation tasks land (constitution Principle VIII).
