# Implementation Plan: Landing Site, Access Login & App-Shell Skeleton

**Branch**: `001-landing-access-login` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-landing-access-login/spec.md`

## Summary

Ship FlightDeck's first deployable slice: a public marketing site (Home/Product/Docs/Self-hosting/
Changelog) matching the approved design, a real Cloudflare Access login flow (replacing the design's
simulated timer) that independently JWT-verifies every authenticated request per constitution
Principle II, and an authenticated app-shell skeleton (sidebar nav across the six product pillars,
real empty states, no mocked telemetry). Technical approach: single Cloudflare Worker running Hono,
serving a React 19 + Vite SPA via the Workers static-assets binding, D1 for the `users`/`projects`
baseline, `jose`-based Access JWT verification mirroring FlareTower's proven pattern, Deno-only
tooling throughout, deployed via Cloudflare Workers Builds watching a `release` branch that
release-please fast-forwards.

## Technical Context

**Language/Version**: TypeScript (strict mode), Deno 2.x runtime for all local tooling; Worker
executes on Cloudflare's `workerd` runtime in production.

**Primary Dependencies**: `hono` (Worker routing), `jose` (Access JWT verification), `react` +
`react-dom` (SPA), `vite` + `@cloudflare/vite-plugin` + `@vitejs/plugin-react` (build), `wrangler`
(deploy/D1/dev), `@playwright/test` (e2e), `@fontsource/ibm-plex-sans` + `@fontsource/ibm-plex-mono`
(self-hosted design-system fonts, matching FlareTower's approach instead of a Google Fonts network
dependency).

**Storage**: Cloudflare D1 (SQLite-compatible), two databases — `flightdeck-production`
(`c14cff3f-5025-46da-8d9a-5425ff6922f8`) and `flightdeck-preview`
(`832ca74f-b6d9-4309-a815-311a61a70cb4`), both already provisioned. Baseline migration: `users`
(Access JWT `sub`-keyed) and a seed `projects` row.

**Testing**: `deno test -A tests/unit/` (JWT verification, user upsert, route auth-gating, marketing
route rendering logic) and Playwright (`tests/e2e/`) for browser-driven flows. The real external
Cloudflare Access IdP challenge cannot be automated in CI (see Research §5) — e2e covers everything
up to and after that redirect; the redirect itself is a manual/staging verification step.

**Target Platform**: Cloudflare Workers (production: `flightdeck.iuma.dev`), evaluated locally via
`wrangler`'s Miniflare-backed dev server through Vite.

**Project Type**: Web application — single Cloudflare Worker serving both the API (`worker/`) and a
built SPA (`app/`), matching FlareTower's structure.

**Performance Goals**: Marketing pages interactive within 2s on typical broadband (spec SC-001);
login-to-app-shell under 15s of active interaction excluding IdP challenge time (spec SC-002). No
dedicated load-testing infrastructure for this module — these are UX-budget targets, not
provisioned-capacity targets.

**Constraints**: `workers_dev: false` from the first commit (constitution Principle I); every
authenticated request independently JWT-verified, fail-closed (Principle II); no ingest/data-plane
endpoint may exist yet (spec FR-014); Deno-only toolchain, one `deno.json` (Principles VI–VII).

**Scale/Scope**: 5 marketing screens + 1 login modal + 10 app-shell screens (Overview, Issues,
Traces, Logs, Releases, Uptime, Feedback, Alerts, Settings, Install SDK) = ~16 screens total, all
client-routed within one SPA bundle. Single Worker, single D1 database pair (prod/preview).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate status |
|---|---|---|
| I. Two Trust Surfaces | Yes — control plane (`/api/internal/*`, SPA) vs. ingest | **PASS** — this module builds only the control-plane side; no ingest route exists yet (spec FR-014), so there is nothing to misclassify. `workers_dev:false` set from wrangler.jsonc's first commit. |
| II. Defense-in-Depth JWT Validation, Fail Closed | Yes — this module's core deliverable | **PASS by design** — the actually-provisioned Access application is scoped to `/login` only (research.md §1, discovered mid-implementation — see constitution v1.1.0). `worker/auth/access-jwt.ts` verifies `Cf-Access-Jwt-Assertion` at `/login` against team JWKS (issuer/audience checks); `worker/auth/session.ts` mints and verifies FlightDeck's own `fd_session` JWT for every other control-plane request. Both steps fail-closed, 403, no degraded mode. Directly testable (spec SC-003). |
| III. DSN-Key Authentication for Ingest | No | **N/A** — no ingest endpoint exists in this module. |
| IV. Sentry Protocol Compatibility | No | **N/A** — Docs page shows the *future* protocol as static reference copy only (spec FR-014); nothing to be incompatible with yet. |
| V. Single Worker, One Module Per Pillar | Yes | **PASS** — `worker/index.ts` single fetch entrypoint; `worker/modules/identity/` owns user upsert; per-pillar route stubs (issues/traces/logs/releases/uptime/feedback) are frontend-only empty states in this module, so no backend module split is forced prematurely. |
| VI. Deno-Only Local Toolchain | Yes | **PASS** — single `deno.json`, no `package.json`. |
| VII. One Configuration File | Yes | **PASS** — `deno.json` holds imports/tasks/fmt/lint/compilerOptions. |
| VIII. Strict TypeScript, Test-First, Playwright | Yes | **PASS** — `compilerOptions.strict: true`; unit tests for auth/user-upsert logic; Playwright for marketing nav, app-shell empty states, sign-out (login-redirect itself is a documented manual-verification exception, Research §5). |
| IX. Customer Telemetry Confidentiality | Partially — no telemetry ingested yet | **PASS** — no payload logging exists yet since there's no ingest. This module does introduce one Worker secret, `SESSION_SECRET` (the HMAC key `worker/auth/session.ts` signs `fd_session` with) — declared via `wrangler secret put`/`wrangler versions secret put`, never as a plain `var`, per Principle IX. No `CF_API_TOKEN` needed this module (FlightDeck doesn't call the Cloudflare API). |
| X. Admin Mutations Are Recorded | Yes, narrowly | **PASS** — no admin mutation exists in this module beyond user auto-provisioning on first login, which is an identity-recognition event, not an "account-level state change" in the sense Principle X's `audit_log` targets (project creation, DSN rotation, member role change — all later modules). `audit_log` table is **not** created in this module's migration; it is deferred to the first module that introduces an actual admin mutation, and this deferral is recorded explicitly here so it isn't silently missed. |
| XI. English-Only, Conventional Commits | Yes | **PASS** — enforced by convention/review, not tooling; noted in CLAUDE.md. |

No violations requiring the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/001-landing-access-login/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   └── internal-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
deno.json                 # single config: imports, tasks, fmt, lint, compilerOptions
wrangler.jsonc             # workers_dev:false, env.production + env.preview, D1/assets bindings
vite.config.ts
playwright.config.ts
release-please-config.json
.release-please-manifest.json
VERSION
LICENSE                    # AGPL-3.0
README.md
CLAUDE.md
.gitignore
.dev.vars.example          # TEAM_DOMAIN / POLICY_AUD documentation (non-secret, but local-only)
.env.development            # CLOUDFLARE_ENV=preview

worker/
├── index.ts                # single fetch entrypoint: routes /api/* + /login to Hono app, else ASSETS
├── auth/
│   ├── access-jwt.ts        # verifyAccessJwt(request, env) — Cf-Access-Jwt-Assertion @ /login only (jose, JWKS cache)
│   ├── session.ts            # mintSession/verifySession — FlightDeck's own fd_session JWT (jose, SESSION_SECRET)
│   └── login-route.ts        # GET /login — verifies Access JWT, upserts user, mints fd_session, 302
├── modules/
│   └── identity/
│       ├── users.ts          # upsertUser(sub, email, idp) — first-login auto-provision
│       └── routes.ts         # sessionAuth middleware + GET /api/internal/me, GET /api/internal/projects
└── db/
    └── migrations/
        └── 0001_baseline.sql # users + seed projects row

app/
├── main.tsx
├── App.tsx                   # top-level: session state, marketing-vs-app-shell switch
├── index.html
├── vite-env.d.ts
├── lib/
│   └── use-session.ts        # fetch /api/internal/me, session state hook
├── styles/
│   └── tokens.css            # design-token CSS custom properties (dark theme, per constitution)
├── pages/                    # marketing site screens
│   ├── HomePage.tsx
│   ├── ProductPage.tsx
│   ├── DocsPage.tsx
│   ├── SelfHostingPage.tsx
│   └── ChangelogPage.tsx
├── shell/                    # authenticated app-shell screens
│   ├── AppShell.tsx           # sidebar + topbar + project switcher layout
│   ├── OverviewScreen.tsx
│   ├── IssuesScreen.tsx
│   ├── TracesScreen.tsx
│   ├── LogsScreen.tsx
│   ├── ReleasesScreen.tsx
│   ├── UptimeScreen.tsx
│   ├── FeedbackScreen.tsx
│   ├── AlertsScreen.tsx
│   ├── SettingsScreen.tsx
│   └── InstallSdkScreen.tsx
└── components/
    ├── SignInModal.tsx
    ├── MarketingNav.tsx
    └── EmptyState.tsx

tests/
├── unit/
│   ├── access-jwt.test.ts
│   └── identity-users.test.ts
└── e2e/
    ├── marketing-nav.spec.ts
    ├── app-shell-empty-states.spec.ts
    └── sign-out.spec.ts

.github/workflows/
├── ci.yml
├── e2e.yml
└── release-please.yml
```

**Structure Decision**: Single Cloudflare Worker web application, directly mirroring FlareTower's
`worker/` + `app/` + `tests/` split (not the generic template's `backend/`+`frontend/` two-project
option) — this is one deployable unit with one Worker binding both the API and the static SPA
build, not two independently deployed services. Per-pillar directories under `worker/modules/`
follow constitution Principle V but only `identity/` is populated this module; the other five
pillars have no backend module yet since they own no data (spec FR-014) — their app-shell screens
are frontend-only empty-state components under `app/shell/`.

## Complexity Tracking

*No Constitution Check violations — table omitted.*
