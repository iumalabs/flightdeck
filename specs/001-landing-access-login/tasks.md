---

description: "Task list for Landing Site, Access Login & App-Shell Skeleton"

---

# Tasks: Landing Site, Access Login & App-Shell Skeleton

**Input**: Design documents from `/specs/001-landing-access-login/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-api.md, quickstart.md

**Tests**: Included — constitution Principle VIII requires tests before a feature is done and
Playwright coverage for every user-facing flow; spec SC-003 requires automated (not manual)
verification of the auth fail-closed behavior.

**Organization**: Tasks are grouped by user story (US1/US2/US3, matching spec.md's priorities) to
enable independent implementation and testing of each.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

## Path Conventions

Single Cloudflare Worker web app per plan.md's Structure Decision: `worker/` (Hono API), `app/`
(React SPA), `tests/` (unit + e2e), all at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: From-scratch repository bootstrap — nothing but `.specify/` and `specs/` exists yet.

- [X] T001 Create the repo directory skeleton (`worker/auth/`, `worker/modules/identity/`,
      `worker/db/migrations/`, `app/pages/`, `app/shell/`, `app/components/`, `app/lib/`,
      `app/styles/`, `tests/unit/`, `tests/e2e/`, `.github/workflows/`) per plan.md's Project
      Structure
- [X] T002 [P] Create `deno.json` (import map for hono, jose, react, react-dom, vite,
      @cloudflare/vite-plugin, @vitejs/plugin-react, wrangler, @playwright/test,
      @cloudflare/workers-types, @types/react, @types/react-dom, @fontsource/ibm-plex-sans,
      @fontsource/ibm-plex-mono, @fontsource/space-grotesk; `tasks` for dev/build/deploy/test/
      test:e2e/db:migrations/fmt/lint; strict compilerOptions) — mirror
      `/home/max/projects/iumalabs/cf/flaretower/deno.json`'s structure, adjusted for this
      module's dependency set
- [X] T003 [P] Create `wrangler.jsonc` (`workers_dev: false`, `preview_urls: true`, `assets`
      binding, `env.production` + `env.preview` symmetric blocks with
      `routes: [{pattern: "flightdeck.iuma.dev", custom_domain: true}]` on production only,
      `vars.TEAM_DOMAIN=https://yugai.cloudflareaccess.com`,
      `vars.POLICY_AUD=f79f510d9061fcd9fbf467b45ebc5bf03948636828a1639024ff127a5bcbf97d`,
      `vars.CF_ACCOUNT_ID=8b655d0dde6d223b9ce11116a014973a`, `d1_databases` binding `DB` pointing
      at `flightdeck-production` (`c14cff3f-5025-46da-8d9a-5425ff6922f8`) for production and
      `flightdeck-preview` (`832ca74f-b6d9-4309-a815-311a61a70cb4`) for preview,
      `migrations_dir: worker/db/migrations`)
- [X] T004 [P] Create `vite.config.ts` (`root: "app"`, `react()` + `cloudflare()` plugins,
      `build.outDir: "../dist/client"`, `build.emptyOutDir: true`)
- [X] T005 [P] Create `.gitignore`, `.dev.vars.example` (documents `TEAM_DOMAIN`/`POLICY_AUD` for
      local dev), `.env.development` (`CLOUDFLARE_ENV=preview`)
- [X] T006 [P] Create `LICENSE` (AGPL-3.0, copied from
      `/home/max/projects/iumalabs/cf/flaretower/LICENSE`)
- [X] T007 [P] Create `VERSION` (`0.1.0`), `release-please-config.json`, and
      `.release-please-manifest.json` (mirroring flaretower's `"simple"` release-type config)
- [X] T008 [P] Create `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`,
      `.github/workflows/release-please.yml` (adapted from flaretower's workflows: self-hosted
      `[self-hosted, general]` runners with fork-safe `ubuntu-latest` fallback on `ci.yml`'s
      `pull_request` trigger, scheduled `e2e.yml`, release-please fast-forwarding a short
      `release` branch)
- [X] T009 [P] Create `README.md` (Status / Authentication / Environment / Releases sections,
      mirroring flaretower's structure, pointing at `.specify/memory/constitution.md` as
      authoritative)
- [X] T010 [P] Create `CLAUDE.md` agent guide (Spec Kit workflow pointer, hard-constraints list,
      `FD-001`-style GitHub issue prefix for `/speckit-taskstoissues`)
- [X] T011 [P] Create `playwright.config.ts` (`testDir: "./tests/e2e"`, `baseURL:
      "http://127.0.0.1:8787"`, `webServer` running `deno run -A npm:vite --port 8787`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The single Worker entrypoint and SPA shell that every user story renders through.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T012 Create `worker/index.ts` — single `fetch` entrypoint: an empty `Hono` app instance
      mounted at `/api/*`, everything else served via `env.ASSETS.fetch(request)`
- [X] T013 [P] Create `app/index.html` and `app/main.tsx` (React root mount)
- [X] T014 [P] Create `app/styles/tokens.css` — dark-theme design tokens as CSS custom properties
      (`--bg: #0B0B0C`, `--accent: #B8F135`, etc., per `FlightDeck.dc.html`) plus `@font-face`
      imports for the self-hosted IBM Plex Sans/Mono and Space Grotesk fonts (research.md §6)
- [X] T015 Create `app/App.tsx` — top-level component with a hand-rolled `pathname` ↔ screen
      lookup-table router driven by `history.pushState`/`popstate` (research.md §4); initially
      renders only the marketing-site branch (session-aware switch added in US2)
- [X] T016 [P] Create `app/lib/use-session.ts` as a typed stub (`{ loading, session }` shape,
      calling nothing yet) so `App.tsx` compiles against its final interface ahead of US2's
      implementation
- [X] T017 Verify `deno task dev` serves the skeleton and `deno task build` succeeds (smoke check —
      no new files, just confirms Phase 1–2 wiring is correct before user story work starts)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Evaluate FlightDeck as a prospective adopter (Priority: P1) 🎯 MVP

**Goal**: An unauthenticated visitor can read the full marketing site (Home/Product/Docs/
Self-hosting/Changelog) via client-side navigation, with every page also correct on a direct visit.

**Independent Test**: Load the site with no session; navigate all five pages via the top nav;
reload directly at a non-home path; confirm no page ever prompts for authentication (quickstart.md
"Validate User Story 1").

### Tests for User Story 1

- [X] T018 [P] [US1] Write `tests/e2e/marketing-nav.spec.ts` (navigate Home → Product → Docs →
      Self-hosting → Changelog via the nav; assert no full-document navigation occurs; reload
      directly at `/docs` and assert it still renders) — expect it to fail until T019-T025 land

### Implementation for User Story 1

- [X] T019 [P] [US1] Create `app/components/MarketingNav.tsx` (sticky top nav: logo → home,
      Product/Docs/Self-hosting/Changelog links, session hint + Login/"Open app →" control)
- [X] T020 [P] [US1] Create `app/pages/HomePage.tsx` (hero headline "Every instrument. One panel.",
      CTA buttons, "Sentry-SDK compatible" badge, mock issue-list panel with sparklines, 6-tile
      feature grid, "migration is one line" code-diff section — content per `FlightDeck.dc.html`)
- [X] T021 [P] [US1] Create `app/pages/ProductPage.tsx` (6 pillar cards + Sentry/GlitchTip/
      FlightDeck comparison table)
- [X] T022 [P] [US1] Create `app/pages/DocsPage.tsx` (left nav + Quickstart/DSN & endpoints/
      Source maps/Releases & deploys/Alerts & webhooks/Access control sections, each with a static
      code block per the design's copy)
- [X] T023 [P] [US1] Create `app/pages/SelfHostingPage.tsx` (Docker Compose/Kubernetes/Cloudflare
      deployment cards, compose + ops code blocks, env-var reference table)
- [X] T024 [P] [US1] Create `app/pages/ChangelogPage.tsx` (a single honest entry describing this
      module, e.g. "0.1.0 — initial release" — per spec Assumptions, no fabricated history)
- [X] T025 [US1] Create a footer component and wire `MarketingNav`, all five pages, and the footer
      into `App.tsx`'s router lookup table (depends on T019-T024)
- [X] T026 [US1] Run `tests/e2e/marketing-nav.spec.ts` and confirm it passes (depends on T025)

**Checkpoint**: The marketing site is fully functional and independently demonstrable.

---

## Phase 4: User Story 2 - Sign in via Cloudflare Access and reach the app (Priority: P1)

**Goal**: Clicking "Log in" performs a real Cloudflare Access redirect; every authenticated
request is independently JWT-verified (fail-closed); a first-time login auto-provisions a user
record; the visitor lands in a minimal authenticated shell showing their identity.

**Independent Test**: As a user covered by the Access policy, click Log in, complete the real
Access challenge, and verify landing in the shell with the correct identity; separately verify a
non-covered user is blocked by Access before ever reaching the app (quickstart.md "Validate User
Story 2").

### Tests for User Story 2

- [X] T027 [P] [US2] Write `tests/unit/access-jwt.test.ts` (`verifyAccessJwt`: valid signed JWT
      against a test JWKS → returns identity; missing header → rejected; invalid signature →
      rejected; wrong audience/issuer → rejected; expired token → rejected) and
      `tests/unit/session.test.ts` (`mintSession`/`sessionAuth`: a minted token verifies and
      round-trips `sub`/`email`/`role`; a tampered/expired/missing `fd_session` cookie → 403) — per
      contracts/internal-api.md — expect both to fail until T031a/T031b land
- [X] T028 [P] [US2] Write `tests/unit/identity-users.test.ts` (first call for a `sub` inserts a
      user with default role and `created_at`/`last_seen_at`; a second call updates `email` and
      `last_seen_at` while preserving `created_at`/`role` — per data-model.md) — expect it to fail
      until T032 lands

### Implementation for User Story 2

- [X] T029 [US2] Create `worker/db/migrations/0001_baseline.sql` (`users` table, `sub`-keyed, per
      data-model.md; seed one `projects` row per research.md §7)
- [X] T030 [US2] Apply the migration locally: `deno task db:migrations:apply:local` (depends on
      T029)
- [X] T031a [P] [US2] Create `worker/auth/access-jwt.ts` — `verifyAccessJwt(request, env)` (`jose`
      `createRemoteJWKSet` cached per team domain, `jwtVerify` with issuer=`TEAM_DOMAIN`/
      audience=`POLICY_AUD` against the `Cf-Access-Jwt-Assertion` header, fail-closed on any
      failure) — adapt (do not copy verbatim) the pattern in
      `/home/max/projects/iumalabs/cf/flaretower/worker/auth/access-jwt.ts`. Per research.md §1
      this is used ONLY by the `/login` route below, not by every control-plane request (depends
      on T030)
- [X] T031b [P] [US2] Create `worker/auth/session.ts` — `mintSession({sub, email, role}, env)` and
      `sessionAuth` Hono middleware verifying the `fd_session` cookie (`jose` `SignJWT`/
      `jwtVerify`, HMAC signed with the `SESSION_SECRET` Worker secret), fail-closed 403 on
      missing/invalid/expired/tampered token (depends on T030)
- [X] T032 [P] [US2] Create `worker/modules/identity/users.ts` — `upsertUser(db, {sub, email,
      idp})` per data-model.md (depends on T030)
- [X] T032b [US2] Create `worker/auth/login-route.ts` — `GET /login`: calls `verifyAccessJwt`, on
      success calls `upsertUser` then `mintSession` and sets the `fd_session` cookie
      (`HttpOnly`/`Secure`/`SameSite=Lax`) with a `302` to `/web-app/`; on failure, `403` with no
      cookie set. Also `POST /logout` in the same file: overwrites `fd_session` with an expired
      cookie, `204` — needed because an `HttpOnly` cookie can't be cleared from client JS
      (research.md §3 correction) (depends on T031a, T032)
- [X] T033 [US2] Create `worker/modules/identity/routes.ts` — `GET /api/internal/me`,
      `GET /api/internal/projects`, gated by `sessionAuth` — per contracts/internal-api.md
      (depends on T031b, T032)
- [X] T034 [US2] Wire the `/login` route and the `sessionAuth`-gated identity routes into
      `worker/index.ts` (depends on T032b, T033, T012)
- [X] T035 [US2] Implement `app/lib/use-session.ts` fully — calls `GET /api/internal/me`, exposes
      `{ loading, session }` (depends on T034, T016)
- [X] T036 [P] [US2] Create `app/components/SignInModal.tsx` — "Sign in" modal matching the
      design's copy/layout; "Continue with Cloudflare Access" performs a real full-page browser
      navigation to `/login` (the one path Access actually protects — no simulated timer)
- [X] T037 [US2] Create a minimal `app/shell/AppShell.tsx` (topbar + sidebar nav links + a basic
      landing panel showing the signed-in identity) and wire `App.tsx`'s router to switch between
      marketing site and shell based on `use-session.ts`'s session state (depends on T035, T036,
      T015)
- [X] T038 [US2] Run `tests/unit/access-jwt.test.ts`, `tests/unit/session.test.ts`, and
      `tests/unit/identity-users.test.ts`, confirm all pass (depends on T031a, T031b, T032-T034)
- [ ] T039 [US2] Manually verify the real end-to-end Access redirect against the deployed preview
      environment per quickstart.md (research.md §5 — not automatable in CI); record the outcome
      in this feature's PR description

**Checkpoint**: Sign-in works end-to-end against the real Cloudflare Access application.

---

## Phase 5: User Story 3 - Navigate the app shell and sign out (Priority: P2)

**Goal**: Every sidebar destination renders a distinct, honest empty state; the user menu shows the
real identity; sign-out returns to the marketing site and re-gates authenticated areas.

**Independent Test**: While authenticated, click through every sidebar destination and confirm
distinct real empty states (no design mock data); confirm the user menu shows the signed-in
identity; sign out and confirm re-authentication is required (quickstart.md "Validate User Story
3").

### Tests for User Story 3

- [X] T040 [P] [US3] Write `tests/e2e/app-shell-empty-states.spec.ts` (using a pre-authenticated
      browser context; visit every sidebar destination — Overview, Issues, Traces, Logs, Releases,
      Uptime, Feedback, Alerts, Settings, Install SDK; assert each shows distinct real empty-state
      copy, none of the design mockup's sample issues/traces/logs) — expect it to fail until
      T042-T053 land
- [X] T041 [P] [US3] Write `tests/e2e/sign-out.spec.ts` (pre-authenticated context; click sign out;
      assert return to the marketing site; reload an app-shell URL directly; assert routed into
      sign-in rather than showing stale content) — expect it to fail until T053-T055 land

### Implementation for User Story 3

- [X] T042 [P] [US3] Create `app/components/EmptyState.tsx` (reusable empty-state presentational
      component)
- [X] T043 [P] [US3] Create `app/shell/OverviewScreen.tsx`
- [X] T044 [P] [US3] Create `app/shell/IssuesScreen.tsx` (empty state: "No issues yet — install an
      SDK to get started")
- [X] T045 [P] [US3] Create `app/shell/TracesScreen.tsx`
- [X] T046 [P] [US3] Create `app/shell/LogsScreen.tsx`
- [X] T047 [P] [US3] Create `app/shell/ReleasesScreen.tsx`
- [X] T048 [P] [US3] Create `app/shell/UptimeScreen.tsx`
- [X] T049 [P] [US3] Create `app/shell/FeedbackScreen.tsx`
- [X] T050 [P] [US3] Create `app/shell/AlertsScreen.tsx`
- [X] T051 [P] [US3] Create `app/shell/SettingsScreen.tsx` (shows the signed-in identity only —
      full settings functionality is out of scope per spec)
- [X] T052 [P] [US3] Create `app/shell/InstallSdkScreen.tsx` (static setup instructions/code
      snippets, may reuse the design's copy per spec)
- [X] T053 [US3] Extend `AppShell.tsx`'s sidebar to route to all 10 screens above, plus a project
      switcher and a user menu (identity + sign-out action) (depends on T042-T052, T037)
- [X] T054 [US3] Wire client-side sign-out in `app/lib/use-session.ts` (clear session state,
      navigate to the marketing site — no server call, per research.md §3) (depends on T053)
- [X] T055 [US3] Add an unauthenticated-redirect guard in `App.tsx`'s router: direct navigation to
      any app-shell URL without a session routes into the sign-in flow instead of rendering shell
      content (depends on T053, T054)
- [X] T056 [US3] Run `tests/e2e/app-shell-empty-states.spec.ts` and `tests/e2e/sign-out.spec.ts`,
      confirm both pass (depends on T053-T055)

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T057 [P] Run `deno fmt` and `deno lint` across `worker/`, `app/`, `tests/`; fix violations
- [X] T058 [P] Run `deno check` (typecheck) across every `.ts`/`.tsx` file, matching `ci.yml`'s
      pattern
- [X] T059 Run the full `quickstart.md` validation end-to-end (all three user stories) and record
      results
- [X] T060 Update `README.md`'s Status section to reference `specs/001-landing-access-login`
- [X] T061 Document, in `README.md`, the required manual Cloudflare Workers Builds dashboard step
      (connect `iumalabs/flightdeck`, production branch = `release`) per plan.md's Deployment &
      Operations section — this cannot be scripted and must not be silently omitted

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only. Fully independent of US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational only. Does not require US1's marketing pages
  to exist (it only needs `App.tsx`'s router and `use-session.ts` stub from Phase 2), though in
  practice both are usually built in priority order.
- **User Story 3 (Phase 5)**: Depends on US2's `AppShell.tsx`, `use-session.ts`, and identity
  routes (T031-T037) — it extends the minimal shell US2 creates rather than building its own.
  This is the one real cross-story dependency in this feature; it is intentional (spec rates US3
  below US2 for exactly this reason) rather than a violation of story independence.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Parallel Opportunities

- All Setup tasks marked `[P]` (T002-T011) can run in parallel once T001 creates the directory
  skeleton.
- T013, T014, T016 (Phase 2) can run in parallel; T012 and T015 are each on their own critical
  path within the phase.
- Within US1, T019-T024 (nav + 5 pages) can all run in parallel; T025 depends on all of them.
- Within US2, T031 and T032 can run in parallel (different files) once T030 completes; T036 can run
  in parallel with T031/T032/T033 (different file, no shared dependency until T037).
- Within US3, T042-T052 (11 files: EmptyState + 10 screens) can all run in parallel; T053 depends
  on all of them.

---

## Parallel Example: User Story 1

```bash
# After Phase 2 (Foundational) completes, launch all five marketing page files together:
Task: "Create app/pages/HomePage.tsx"
Task: "Create app/pages/ProductPage.tsx"
Task: "Create app/pages/DocsPage.tsx"
Task: "Create app/pages/SelfHostingPage.tsx"
Task: "Create app/pages/ChangelogPage.tsx"
Task: "Create app/components/MarketingNav.tsx"
```

## Parallel Example: User Story 3

```bash
# After US2's AppShell/use-session/identity routes exist, launch all screen files together:
Task: "Create app/shell/OverviewScreen.tsx"
Task: "Create app/shell/IssuesScreen.tsx"
Task: "Create app/shell/TracesScreen.tsx"
Task: "Create app/shell/LogsScreen.tsx"
Task: "Create app/shell/ReleasesScreen.tsx"
Task: "Create app/shell/UptimeScreen.tsx"
Task: "Create app/shell/FeedbackScreen.tsx"
Task: "Create app/shell/AlertsScreen.tsx"
Task: "Create app/shell/SettingsScreen.tsx"
Task: "Create app/shell/InstallSdkScreen.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run `tests/e2e/marketing-nav.spec.ts`, do a manual click-through
5. This alone is deployable as a real marketing site, even before login exists

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → validate independently → marketing site demoable
3. Add US2 → validate independently (including the manual real-Access-redirect check) → login
   works end-to-end, minimal shell
4. Add US3 → validate independently → full navigable shell with honest empty states and sign-out
5. Polish (Phase 6) → fmt/lint/typecheck clean, README/quickstart current, deploy prerequisites
   documented

### Notes

- `[P]` tasks touch different files with no unmet dependency — safe to parallelize.
- Tests are written first within each story's phase and are expected to fail until that story's
  implementation tasks land (constitution Principle VIII).
- US3 depends on US2's shell scaffold — this is the one intentional cross-story dependency;
  otherwise each story is independently testable and deployable per its own Independent Test in
  spec.md.
- Commit after each task or logical group; stop at any checkpoint to validate a story
  independently before continuing.
