---

description: "Task list for Releases"

---

# Tasks: Releases

**Input**: Design documents from `/specs/005-releases/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution Principle VIII requires tests before a feature is done; this
module's highest-risk logic (release-health aggregation, regression-detection release-ordering,
API-token hash/verify) is pure-function-testable and gets unit coverage first, with contract tests
against a real `wrangler dev` using hand-crafted requests matching sentry-cli's confirmed wire
format (research.md §8), and Playwright for the UI flow.

**Organization**: Tasks are grouped by user story (US1-US4, matching spec.md's priorities: US1=P1,
US2=P1, US3=P2, US4=P3). US2 depends on US1 (releases must exist before health data attaches to
them, and the API-token infrastructure US1 builds gates all release-management writes). US3 depends
on US1 (releases must exist and be ordered) but not on US2. US4 depends on US1 only.

**✅ Status**: Implemented (all 44 original tasks). Verified live against a real `wrangler dev`: the
full sentry-cli-compatible flow (create/upload-sourcemaps/finalize/set-commits/deploys/list), API
token generate/revoke/reject-on-invalid/reject-on-revoked, session-ingest release health with
numerically confirmed adoption/crash-free figures, and BOTH directions of regression detection
(reopens on a later release, stays resolved on the same/earlier one) — research.md §7. One real bug
found and fixed via this live testing: the finalize/set-commits PUT response was echoing stale
request-body state instead of the release's actual current DB state — research.md §1.
A subsequent `/speckit-converge` pass found and this branch closed three further HIGH-severity gaps
(Phase 8, T045-T047: missing protocol path variants, an unwindowed adoption figure, and an
API-token-hashing design contradiction) — see Phase 8 below. One LOW-severity gap (T048) remains
open, tracked but not required to close.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- File paths are relative to the repository root

## Path Conventions

Extends Modules 1-4's `worker/` (Hono API) + `app/` (React SPA) + `tests/` (unit + contract + e2e)
layout — see plan.md's Structure Decision. No new top-level directories, no new Cloudflare
bindings.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Create directory skeleton: `worker/modules/releases/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, the new API-token auth mechanism, and the session-item dispatch every user
story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Create `worker/db/migrations/0005_releases.sql` — additive `releases.date_released`/
      `ref`/`url`; additive `issues.status`/`resolved_release_id`/`resolved_mode`; new
      `api_tokens`, `release_commits`, `deploys`, `release_health`, `release_health_users` tables
      per data-model.md, including `release_health`'s `UNIQUE(project_id, release_id, environment,
      date)` and `release_health_users`' `UNIQUE(project_id, release_id, environment, date, did)`
- [X] T003 Apply the migration locally: `deno task db:migrations:apply:local` (depends on T002)
- [X] T004 Implement `worker/auth/api-token.ts` — token generation (a cryptographically random
      value, shown once), salted-hash computation via Web Crypto (matching the defensive posture
      already used for session/DSN credentials), and a `verify(token)` function checking a hash
      against `api_tokens` (depends on T001)
- [X] T005 Implement the `apiTokenAuth` middleware (parallel to `worker/auth/session.ts`'s
      `sessionAuth`) — extracts `Authorization: Bearer <token>`, verifies via T004, fails closed
      (403) on missing/invalid/revoked (constitution Principle III's posture, research.md §4)
      (depends on T004)
- [X] T006 Add `isSessionItem()` to `worker/modules/ingest/envelope.ts` alongside the existing
      `isEventItem()`/`isTransactionItem()`/`isLogItem()`, dispatching on `"session"`/`"sessions"`
      item types (research.md §5) (depends on T001)
- [X] T007 Mount an empty, `apiTokenAuth`-gated `releasesRoutes` router under `/api/0` in
      `worker/index.ts` (sentry-cli-facing) and an empty, `sessionAuth`-gated router under
      `/api/internal/releases` (dashboard-facing) (depends on T005, T001)
- [X] T008 Verify `deno task build` and `deno check` still pass with the new bindings/tables/empty
      routes wired in (smoke check, no new files)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Ship a release through existing CI tooling, unmodified (Priority: P1) 🎯 MVP

**Goal**: A real, unmodified `sentry-cli` installation, pointed at FlightDeck via `SENTRY_URL`, can
create a release, upload its source maps, and finalize it.

**Independent Test**: quickstart.md's "Validate User Story 1" — a real `sentry-cli` invocation (or
hand-crafted HTTP requests per the contract-level alternative) against a running `wrangler dev`,
confirming the full create→upload→finalize flow and that source maps resolve correctly against a
subsequently-ingested error.

### Tests for User Story 1

- [X] T009 [P] [US1] Write `tests/unit/api-token.test.ts` (a generated token's hash verifies
      correctly; a wrong/tampered token fails verification; a revoked token's hash fails
      verification even if otherwise correct) — expect it to fail until T012 lands
- [X] T010 [P] [US1] Write a unit test for sentry-cli endpoint request-shape parsing (the `org_slug`
      path segment is accepted regardless of value; `projects: [slugs]` in the release-creation body
      correctly resolves which real project(s) a release belongs to) — expect it to fail until
      T014 lands
- [X] T011 [US1] Write `tests/contract/release-management-api.spec.ts` (against real `wrangler
      dev`: hand-crafted requests matching contracts/release-management-api.md's confirmed wire
      format for create/upload-sourcemaps/finalize; asserts a repeated `releases new` for the same
      version is a no-op per spec FR-004; asserts `403` for an invalid or revoked token) — expect
      it to fail until T012-T017 land (depends on T010)

### Implementation for User Story 1

- [X] T012 [US1] Implement `worker/auth/api-token.ts`'s DB-backed generate/verify against
      `api_tokens` (depends on T004, T002, T009)
- [X] T013 [US1] Wire `apiTokenAuth` against T012's real verify function, replacing any stub
      (depends on T005, T012)
- [X] T014 [US1] Implement `POST /api/0/organizations/:orgSlug/releases/` (create) in
      `worker/modules/releases/routes.ts` per contracts/release-management-api.md (depends on T013,
      T003, T010)
- [X] T015 [US1] Implement `POST /api/0/projects/:orgSlug/:projectSlug/releases/:version/files/`
      (upload source maps) — writes into Module 2's EXISTING `source_maps`/`releases` tables, an
      additive second front door alongside Module 2's dashboard upload endpoint (depends on T013,
      T003)
- [X] T016 [US1] Implement the finalize endpoint (sets `releases.date_released`, idempotent)
      (depends on T013, T003)
- [X] T017 [US1] Wire the real `releasesRoutes` into `worker/index.ts` under `/api/0`, replacing
      T007's stub (depends on T014-T016, T007)
- [X] T018 [P] [US1] Implement `POST /api/internal/projects/:id/api-tokens` and
      `DELETE .../api-tokens/:tokenId` (`sessionAuth`-gated) per contracts/releases-internal-api.md
      (depends on T012)
- [X] T019 [P] [US1] Add an API token management section to `app/shell/SettingsScreen.tsx`
      (generate — showing the raw token once — and revoke) (depends on T018)
- [X] T020 [US1] Run T009-T011's tests, confirm all pass (depends on T012-T017)

**Checkpoint**: A real `sentry-cli` release flow works end to end against FlightDeck.

---

## Phase 4: User Story 2 - See how a release is actually performing (Priority: P1)

**Goal**: Session-outcome data ingested for a release correctly aggregates into adoption and
crash-free figures, visible per environment on the Releases screen.

**Independent Test**: quickstart.md's "Validate User Story 2" — ingest a known distribution of
session outcomes, confirm the dashboard's figures match.

**Depends on**: User Story 1 (releases must exist to attach health data to, and the API-token
infrastructure gates release-management writes this data references).

### Tests for User Story 2

- [X] T021 [P] [US2] Write `tests/unit/release-health.test.ts` (folding `"session"`/`"sessions"`
      items into correct daily counters; crash-free session/user rate computation against a known
      distribution; the `release_health_users` cap behavior at and beyond 10,000 distinct `did`
      values, research.md §6) — expect it to fail until T023 lands
- [X] T022 [US2] Extend `tests/contract/release-management-api.spec.ts` (or a sibling file) with
      session-ingest coverage: hand-crafted `"session"`/`"sessions"` envelope items, polling
      `GET /api/internal/releases/{id}` until the aggregate reflects them, asserting correctness
      against the known ingested distribution — expect it to fail until T024-T025 land

### Implementation for User Story 2

- [X] T023 [US2] Implement `worker/modules/ingest/release-health.ts` — the pure aggregation
      function (session outcomes → daily counters, crash-free rate computation) (depends on T021)
- [X] T024 [US2] Wire `"session"`/`"sessions"` dispatch into `worker/modules/ingest/routes.ts`,
      calling T023's aggregation and UPSERTing `release_health` + (capped) `release_health_users`
      rows (depends on T006, T023, T003)
- [X] T025 [US2] Implement `GET /api/internal/releases` and `GET /api/internal/releases/:id` in
      `worker/modules/releases/routes.ts`, computing adoption/crash-free figures from
      `release_health`, with the "no data yet" honest-empty-state behavior (spec FR-006) (depends
      on T024)
- [X] T026 [P] [US2] Create `app/shell/ReleasesScreen.tsx`'s real list (replacing Module 1's static
      empty state) and `app/shell/ReleaseDetailScreen.tsx` (per-environment breakdown) (depends on
      T025)
- [X] T027 [US2] Run T021-T022's tests, confirm all pass (depends on T023-T026)

**Checkpoint**: Release health is visible and correct, independent of regression detection or
commits/deploys.

---

## Phase 5: User Story 3 - Know when a fixed bug comes back (Priority: P2)

**Goal**: Resolving an issue against a release, then recurring in a later release, automatically
reopens it — and does NOT reopen for the same or an earlier release.

**Independent Test**: quickstart.md's "Validate User Story 3" — resolve, ingest a later-release
recurrence, confirm reopening; ingest a same/earlier-release recurrence, confirm it stays resolved.

**Depends on**: User Story 1 (releases must exist and be creation-ordered). Independent of User
Story 2.

### Tests for User Story 3

- [X] T028 [P] [US3] Write `tests/unit/regression.test.ts` (a later release correctly triggers
      reopening for both resolution modes; the same or an earlier release does NOT trigger
      reopening; "resolved in next release" mode correctly uses the resolution-time latest release
      as its comparison basis, not a release created before the resolution) — expect it to fail
      until T029 lands

### Implementation for User Story 3

- [X] T029 [US3] Implement `worker/modules/ingest/regression.ts` — the pure release-ordering
      comparison function, both resolution modes (research.md §7) (depends on T028)
- [X] T030 [US3] Wire the regression check into `worker/modules/ingest/routes.ts`'s EXISTING
      `"event"` item handler, immediately after Module 2's issue-upsert logic (depends on T029,
      T003)
- [X] T031 [US3] Implement `POST /api/internal/issues/:id/resolve` in Module 2's EXISTING
      `worker/modules/issues/routes.ts`, both modes, per contracts/releases-internal-api.md
      (depends on T003)
- [X] T032 [P] [US3] Add a resolve action and a "regressed in release X" indicator (inferred from
      `status`/`resolved_release_id`, data-model.md — no history table) to
      `app/shell/IssueDetailScreen.tsx` (depends on T031)
- [X] T033 [US3] Run T028's test, confirm it passes (depends on T029-T030)

**Checkpoint**: Regression detection works correctly for both resolution modes.

---

## Phase 6: User Story 4 - Attribute a release to its commits and deploys (Priority: P3)

**Goal**: `sentry-cli releases set-commits`/`deploys new`/`list`/`delete` all work correctly against
FlightDeck.

**Independent Test**: quickstart.md's "Validate User Story 4."

**Depends on**: User Story 1 only. Independent of User Stories 2 and 3.

### Tests for User Story 4

- [X] T034 [P] [US4] Write a unit test for the commit-range-to-`release_commits` mapping logic
      (given a list of commits from Module 2's GitHub App infrastructure, correctly shapes the
      rows to insert) — expect it to fail until T035 lands

### Implementation for User Story 4

- [X] T035 [US4] Implement the `set-commits` endpoint in `worker/modules/releases/routes.ts`,
      integrating Module 2's EXISTING `worker/modules/github/app-auth.ts` for the commit-range
      lookup against the project's connected repository (depends on T034, T017)
- [X] T036 [US4] Implement the `deploys new` endpoint (depends on T017)
- [X] T037 [US4] Implement the `releases list`/`delete` endpoints, both org- and project-scoped
      path variants (depends on T017)
- [X] T038 [P] [US4] Add commits and deploys sections to `app/shell/ReleaseDetailScreen.tsx`
      (depends on T035, T036, T026)
- [X] T039 [US4] Run T034's test, confirm it passes (depends on T035)

**Checkpoint**: All four user stories are independently functional — the full sentry-cli release
surface works.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T040 [P] Run `deno fmt` and `deno lint` across `worker/`, `app/`, `tests/`; fix violations
- [X] T041 [P] Run `deno check` (typecheck) across every new/changed `.ts`/`.tsx` file
- [X] T042 [P] Write `tests/e2e/releases-and-resolve.spec.ts` — releases list→detail UI flow, the
      issue-resolve action from `IssueDetailScreen.tsx`
- [X] T043 Run the full `quickstart.md` validation end-to-end (all four user stories, including a
      REAL `sentry-cli` installation per research.md §8) and record results
- [X] T044 Update `README.md`'s Status section to reference `specs/005-releases`; document the new
      API-token auth mechanism in the Authentication section, distinguishing it clearly from
      session auth and DSN-key ingest auth (research.md §4)

---

## Phase 8: Convergence

A `/speckit-converge` pass against the live codebase found the following gaps between
contracts/research.md's documented protocol coverage and `worker/modules/releases/routes.ts`'s
actual implementation, plus one design contradiction in the API-token hashing scheme. HIGH-severity
items (T045-T047) are required for this module to be truthfully "done"; T048 is a lower-severity
follow-up, tracked but not required to close this convergence pass.

- [X] T045 [HIGH] [US1] `worker/modules/releases/routes.ts` only implemented the org-scoped release
      list/delete endpoints. Added the project-scoped path variants
      (`/api/0/projects/{org_slug}/{project_slug}/releases/...` for list/retrieve/delete) and the
      org-scoped single-release retrieve endpoint
      (`GET /api/0/organizations/{org_slug}/releases/{version}/`), per contracts/
      release-management-api.md and research.md §1/§3's confirmed full protocol coverage. Shared
      query logic (`listReleasesForProject`/`getReleaseForProject`/`deleteReleaseForProject`) factors
      out the org- vs. project-scoped duplication; a new `isProjectSlugAuthorized` helper in
      `request-shape.ts` (unit-tested) mirrors the existing `isProjectAuthorized`'s authorization
      rule for the single-slug path-parameter case. Contract-tested end to end
      (`tests/contract/release-management-api.spec.ts`).
- [X] T046 [HIGH] [US2] `computeReleaseFigures`'s `adoptionPercent` summed `sessions_total` over
      ALL historical `release_health` rows, not a recent window — contradicting spec.md User Story 2
      Acceptance Scenario 1's "share of RECENT sessions" definition. Windowed the adoption
      computation (both the release's own recent sessions and the project-wide recent-sessions
      denominator) to the last 14 days, via a separate, narrower `release_health` query (crash-free
      rate figures are intentionally left lifetime-scoped — unaffected, not described as
      "recent"-windowed by spec.md). 14 days chosen explicitly (no day count is stated in
      spec.md/research.md): `release_health` is daily-granularity data (data-model.md), so 1 day
      would be too sparse for low-traffic/local-testing use; this module introduces no new retention
      window of its own (plan.md's Principle IX note), so 14 days sits between the two comparable
      bounded windows already established elsewhere in this codebase — logs' 7-day window
      (specs/004-structured-logs) and traces/uptime's 30-day window (specs/003-distributed-tracing,
      specs/006-uptime-monitoring). Added a numeric `adoptionPercent` assertion to the existing
      contract test (previously asserted only `crashFreeSessionRate`) — the other half of SC-002's
      "verified by automated test" requirement.
- [X] T047 [HIGH] API-token hashing contradicted data-model.md/plan.md/README.md's documented
      "salted hash": `hashToken` was plain `SHA-256(rawToken)`, no secret involved. Implemented the
      project owner's decided design — HMAC-with-a-secret-pepper, backward compatible with every
      already-issued token, no forced reissuance. `hashToken(rawToken, pepper)` now computes
      `HMAC-SHA256(key=API_TOKEN_PEPPER, message=rawToken)` via Web Crypto; the old plain-SHA256
      function is kept (renamed `legacySha256Hex`, not deleted). `verifyApiToken` computes BOTH
      candidate hashes from the presented raw token and matches `WHERE token_hash = ?1 OR
      token_hash = ?2` — a pre-existing token's row (created under the old scheme) keeps
      authenticating via the legacy branch forever; a newly-created token is stored under the new
      HMAC scheme automatically, since token creation calls the same `hashToken`. No DB migration —
      deliberately schema-free. New Worker secret `API_TOKEN_PEPPER` threaded through
      `ApiTokenEnv`/`apiTokenAuth`/the release-creation route, added to both `env.production` and
      `env.preview`'s `secrets.required` in `wrangler.jsonc`, documented in `.dev.vars.example` and
      README's Environment table. `tests/unit/api-token.test.ts` updated for the new signatures, with
      new coverage proving: a legacy (plain-SHA256) row still authenticates; a new token's hash is
      NOT plain SHA-256 (the pepper is actually applied); an unknown token still fails closed against
      a store holding both legacy and HMAC rows. **Manual follow-up required** (not done by this
      task, not automatable): a repo owner must provision the real `API_TOKEN_PEPPER` secret in both
      the production and preview Cloudflare environments via `wrangler versions secret put
      API_TOKEN_PEPPER`, the same way `SESSION_SECRET`/`GITHUB_APP_PRIVATE_KEY`/
      `CLOUDFLARE_R2_ADMIN_TOKEN` were provisioned.
- [ ] T048 [LOW] `deploys new --release <v> -e <env>`'s documented request shape
      (contracts/release-management-api.md) includes an optional `dateFinished` field the current
      `POST .../deploys/` handler never reads or persists (`deploys.deployed_at` always defaults to
      `datetime('now')` at insert time, never the client-supplied value). Lower severity than
      T045-T047: sentry-cli itself doesn't send this field on `deploys new` in practice, and the
      deploy record's existence/environment/release association — the part every test and the real
      quickstart.md flow actually exercises — is unaffected. Left unimplemented; not required for
      this convergence pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on User Story 1 (releases must exist; API-token
  infrastructure gates writes).
- **User Story 3 (Phase 5)**: Depends on User Story 1 (releases must exist and be ordered).
  Independent of User Story 2.
- **User Story 4 (Phase 6)**: Depends on User Story 1 only. Independent of User Stories 2 and 3.
- **Polish (Phase 7)**: Depends on all four user stories.

### Parallel Opportunities

- Setup: T001 alone.
- Foundational: T002→T003 sequential (migration then apply); T004, T006 can proceed in parallel
  once T001 lands; T005 after T004; T007 after T005; T008 after all.
- Within US1: T009, T010 (tests) in parallel; T011 depends on T010.
- User Story 2, User Story 3, and User Story 4 can all proceed in parallel with each other once
  User Story 1 is complete (none depends on either of the others).
- Within US2: T021 alone before T023; T026 can proceed once T025 lands, in parallel with T022's
  contract test.
- Within US3: T028 alone before T029; T032 can proceed once T031 lands.
- Within US4: T034 alone before T035; T038 can proceed once T035/T036 land.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Setup + Foundational
2. User Story 1
3. **STOP and VALIDATE**: run quickstart.md's User Story 1 validation against a real `sentry-cli`
   installation
4. This alone proves the core "point existing CI tooling at a new endpoint, no rewrite" promise —
   the same category of proof Module 2's MVP delivered for SDKs.

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → validate independently → sentry-cli release flow works (MVP)
3. Add US2, US3, US4 in any order (all depend only on US1) → validate each independently
4. Polish → fmt/lint/typecheck clean, README documents the new auth mechanism clearly

### Notes

- Unlike every prior module, User Stories 2, 3, and 4 here are ALL independent of each other once
  User Story 1 lands — there is no forced linear ordering among them, giving genuine flexibility in
  which to build second.
- Tests are written first within each story's phase and are expected to fail until that story's
  implementation tasks land (constitution Principle VIII).
- T043's quickstart validation is the one task in this module that deliberately uses a REAL
  `sentry-cli` binary rather than hand-crafted requests (research.md §8) — this is intentional, not
  an inconsistency with the rest of the test suite's approach.

---

## Phase 9: Convergence (post migration 0009 — numeric project id)

A fresh `/speckit-converge` pass, run specifically to check this module against
`worker/db/migrations/0009_numeric_project_id.sql` (PR #70, `projects.id` UUID/TEXT →
auto-incrementing INTEGER, project-wide). Verified in detail: `worker/auth/api-token.ts`'s dual
HMAC/legacy hash lookup, `worker/modules/releases/routes.ts`'s org- and project-scoped route logic,
and `worker/modules/releases/request-shape.ts`'s `isProjectAuthorized`/`isProjectSlugAuthorized` all
already correctly treat a project id as an opaque string end-to-end (`CAST(project_id AS TEXT)` at
every read, consistent with the project-wide convention `worker/modules/projects/resolve.ts`
established) — no type-coercion bug found in this module's code, and `deno fmt`/`deno lint`/
`deno check` are clean across `worker/modules/releases/` and `worker/auth/api-token.ts`. All 31
existing unit tests for this module (`api-token.test.ts`, `release-health.test.ts`,
`regression.test.ts`, `release-request-shape.test.ts`) pass unchanged. The gaps below are all in
this module's own design/testing docs, which PR #70 never touched, plus one pre-existing
test-coverage gap unrelated to the migration that surfaced during this pass. No CRITICAL/HIGH
findings.

- [X] T049 [MEDIUM] `specs/005-releases/quickstart.md`'s "Validate User Story 1" section (line 16)
      still mints an API token against the pre-migration literal project id: `curl -X POST
      http://127.0.0.1:8787/api/internal/projects/demo/api-tokens`. Since migration 0009,
      `projects.id` is an auto-incrementing INTEGER (the seeded demo project is deterministically
      `1` — migration 0009's `INSERT INTO projects (name, dsn_public_key) VALUES ('Demo Project',
      ...)` on a freshly-recreated table), and `tests/contract/release-management-api.spec.ts` was
      already updated post-PR-70 (commit a1baf9f) to mint tokens against project id `"1"` instead of
      `"demo"`. Following quickstart.md verbatim against a real, freshly-migrated local environment
      mints a token scoped to a project id ("demo") that matches no real project —
      `apiTokensRoutes.post("/:id/api-tokens")` (worker/modules/releases/routes.ts:601) never
      validates the id exists before inserting — so every subsequent `sentry-cli` command in the
      walkthrough then gets a silent `403` (`isProjectAuthorized`/`isProjectSlugAuthorized` never
      matching), not the confirmed working flow the doc claims to demonstrate. This is this module's
      own primary manual end-to-end validation procedure (SC-005, US1's Independent Test, T043's
      "real sentry-cli installation" step) and is currently broken/misleading for anyone following it
      fresh. (contradicts — spec SC-005, US1 Independent Test)
      Remaining work: update quickstart.md's example project id from `demo` to `1` (or note that it
      must be read from `GET /api/internal/v1/projects` / the dashboard rather than hardcoded).
- [ ] T050 [MEDIUM] `tests/contract/release-management-api.spec.ts` has no test exercising the
      `set-commits` shape (`PUT /api/0/organizations/{org_slug}/releases/{version}/` with a
      non-empty `commits` array) or the `deploys new` endpoint (`POST
      .../releases/{version}/deploys/`) — confirmed by direct grep: zero matches for
      `"deploys"`/`"commits"` in that file. Every other endpoint this module exposes (create,
      upload-sourcemaps, finalize, list/retrieve/delete in both org- and project-scoped forms,
      session-health ingest) has contract-level coverage; these two do not, leaving plan.md's own
      committed testing strategy ("contract tests against a real wrangler dev... matching sentry-cli's
      confirmed wire format", plan.md Testing section) and US4's Independent Test unverified by the
      automated suite — only manually exercised via quickstart.md's real `sentry-cli` run (T043). The
      endpoints themselves are implemented correctly (`worker/modules/releases/routes.ts`'s PUT
      handler and `/deploys/` handler) and were manually validated per T043 — this is a coverage gap,
      not a broken feature, and US4 is this module's lowest-priority (P3) story. (partial — plan.md
      Testing strategy, US4 Independent Test, constitution Principle VIII)
      Remaining work: add two contract-test cases to
      `tests/contract/release-management-api.spec.ts` — one asserting a `set-commits`-shaped PUT
      persists `release_commits` rows (visible via `GET /api/internal/v1/releases/{id}`'s `commits`
      array), one asserting a `deploys new`-shaped POST persists a deploy (visible via the same
      endpoint's `deploys` array).
- [X] T051 [LOW] `specs/005-releases/data-model.md` documents `project_id` as `TEXT` for both the
      Release Health table (line 42) and the API Token table (line 79); the actual column type since
      migration 0009 is `INTEGER` (`worker/db/migrations/0009_numeric_project_id.sql`). Separately,
      and unrelated to the migration, data-model.md's API Token field notes (line 80) still describe
      token hashing as "Salted hash" even though the design actually implemented and accepted (T047,
      `worker/auth/api-token.ts`'s `hashToken`) is an HMAC-with-a-shared-pepper scheme, explicitly
      reasoned in code comments as NOT a per-token salt (a true salt would break the
      hash-lookup-first authentication flow). README.md's Authentication section already describes
      the HMAC-pepper design accurately; data-model.md was never updated to match. (contradicts —
      data-model.md vs. current schema/implementation)
      Remaining work: update data-model.md's Release Health and API Token `project_id` rows to
      `INTEGER`, and reword the API Token table's hashing description from "Salted hash" to match the
      actual HMAC-with-pepper design.
- [X] T052 [LOW] This file (`specs/005-releases/tasks.md`) contains two separate "## Phase 8:
      Convergence" sections: the one ending at T048 (line 332, "this convergence pass.") which
      matches this file's own preamble narrative — the "✅ Status" section near the top — and carries
      the actual implemented rationale for T045-T047; and a second, apparently orphaned draft copy
      immediately below the "Dependencies & Execution Order"/"Implementation Strategy" sections
      (ending at the T048 directly above this Phase 9 header), reusing the SAME ids T045-T048 with
      different (shorter, pre-implementation-style) descriptions, all left unchecked. A reader or
      agent skimming for "is T045 done" could land on the second copy and wrongly conclude it is
      still open. Not resolved by this pass — converge only appends, never edits/removes existing
      phases — flagged here so a maintainer can deliberately delete the stale duplicate. (contradicts
      — internal document self-consistency, no functional/spec impact)
      Remaining work: a maintainer confirms the first "Phase 8: Convergence" section (ending "this
      convergence pass.", T048 LOW/open) is the authoritative record, then deletes the second,
      duplicate "## Phase 8: Convergence" block (the one immediately above this Phase 9 section)
      entirely.
