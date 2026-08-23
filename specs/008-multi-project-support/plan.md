# Implementation Plan: Multi-Project Support

**Branch**: `008-multi-project-support` | **Date**: 2026-08-23 | **Spec**: [spec.md](./spec.md)

**Status note**: Planned and implemented immediately per explicit user instruction — this is new
scope discovered mid-session (post-hoc, an 8th module beyond the constitution's original 7-module
roadmap), built specifically to unblock connecting a real second application (typestreak.app) for
monitoring. No constitution amendment is needed: nothing here contradicts an existing principle —
Principle V's shared-module rule and Principle X's audit-log rule directly govern this work, and
this plan follows them rather than working around them. This module's migration is **none** — the
`projects` table and `dsn_public_key` column already exist from `0002_error_monitoring.sql`; this
feature is route/frontend work only, no schema change.

## Summary

Two things, both already latent in the existing schema: (1) `POST /api/internal/projects`, a new
route generating a project row + DSN using the exact same `lower(hex(randomblob(16)))` expression
migration 0002 already uses to seed "demo"; (2) a `?project=<id>` query parameter, read by every
dashboard-facing internal route that currently hardcodes `PROJECT_ID = "demo"` (confirmed via direct
grep: `traces/routes.ts`, `feedback/routes.ts`, `uptime/routes.ts`, `logs/routes.ts` ×2,
`releases/routes.ts`) or has no project filter at all (`issues/routes.ts`'s two routes), resolved
through one new shared helper per constitution Principle V rather than six copy-pasted call sites.
The frontend's existing static project-name chip becomes a real switcher, backed by a new
`useSelectedProject()` hook mirroring the existing `use-session.ts` pattern, and every
project-scoped `fetch()` call across ~11 screen components gains the query param.

## Technical Context

**Language/Version**: TypeScript (strict mode), Deno 2.x — unchanged from Modules 1-7.

**Primary Dependencies**: None new.

**Storage**: D1 only — no migration. `projects`/`dsn_public_key` already exist (migration 0002).

**Testing**: `deno test` for the new shared `resolveRequestedProject()` helper (valid id passed
through unchanged; omitted/invalid id falls back to the first project by `created_at ASC`; no
projects exist — an edge case only reachable in a broken seed state, returns `null` rather than
throwing). Contract tests against a real `wrangler dev`: `POST /api/internal/projects` creates a
project with a real, working DSN — verified by actually ingesting an event with it and confirming
it does NOT appear when the dashboard queries the OTHER project's `?project=` scope (the real proof
that isolation works, not just that two DB rows exist); every previously-hardcoded route responds
correctly to an explicit `?project=` override, and to its omission (falls back correctly). Playwright
e2e: create a second project through Settings, confirm the switcher appears only once `projects.length
> 1`, switch to it, confirm empty states (not "demo"'s data) render across Issues/Traces/Logs/
Releases/Uptime/Feedback.

**Target Platform**: Cloudflare Workers, same production/preview split as Modules 1-7. No new
deployable unit, no new binding.

**Performance Goals**: project creation + DSN visible in under 30s without leaving the dashboard
(spec SC-001); switching projects re-scopes every screen with no cross-project data leakage
(spec SC-002); a single-project workspace is unaffected (spec SC-003, SC-009).

**Constraints**: the query-param default (first project by `created_at ASC`) MUST match what
`GET /api/internal/projects` already returns as `projects[0]` today, so a single-project workspace's
behavior is bit-for-bit unchanged (spec FR-009) — this is a hard compatibility constraint, not a
preference. Ingest-side DSN resolution (`resolveProjectByDsnKey`) is explicitly untouched (spec
FR-008) — this feature only reads `?project=` on the internal dashboard surface, never on any
`/api/{projectId}/envelope` or `/api/embed/error-page` route.

**Scale/Scope**: 1 new route (`POST /api/internal/projects`), 1 new shared helper module
(`worker/modules/projects/resolve.ts`), 6 existing route files updated to read the resolved project
instead of a hardcoded constant (`issues`, `traces`, `logs`, `uptime`, `releases`, `feedback`), 1 new
frontend hook (`app/lib/use-selected-project.ts`), ~11 screen components updated to pass `?project=`,
1 new form section in `SettingsScreen.tsx`, 0 new D1 tables/columns, 0 new Cloudflare bindings.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate status |
|---|---|---|
| I. Two Trust Surfaces | Yes | **PASS** — the new `POST /api/internal/projects` route and every updated route stay strictly within the existing control-plane surface, `sessionAuth`-gated unchanged. No ingest route is touched (spec FR-008) — `?project=` is read only by internal dashboard routes, never by the DSN-authenticated envelope/dialog endpoints, so the two surfaces stay cleanly separated. |
| II. Defense-in-Depth (control plane) | Yes | **PASS** — reuses `sessionAuth` unchanged on every new/updated route. |
| III. DSN-Key Authentication (ingest) | N/A, confirmed unchanged | Ingest continues to resolve project solely from the DSN key (`resolveProjectByDsnKey`), exactly as Module 2 built it — this feature adds a way to *create* a DSN, not a way to *authenticate* with one differently. |
| IV. Sentry Protocol Compatibility | N/A | This feature touches no protocol-facing surface — the new DSN's format is unchanged from every existing project's (`https://{key}@{host}/{projectId}`), so any SDK pointed at it works exactly as it already does against "demo". |
| V. Single Worker, One Module Per Pillar | Yes — this module's central requirement | **PASS by design, proof-by-construction required**: the "resolve which project this request is scoped to" logic is genuinely cross-pillar (six different pillar modules all need it) — exactly the shared-mechanics case Principle V names explicitly. `worker/modules/projects/resolve.ts`'s `resolveRequestedProject()` is the single implementation every pillar's routes.ts imports; a dedicated test (research.md §2) verifies no pillar reimplements the fallback-to-first-project logic independently. |
| VI. Deno-Only Local Toolchain | Yes | **PASS** — no new dependency. |
| VII. One Configuration File | Yes | **PASS** — no `wrangler.jsonc` change at all; no new binding, no new migration. |
| VIII. Strict TypeScript, Test-First, Playwright | Yes | **PASS by design** — see Testing above. |
| IX. Customer Telemetry Confidentiality | N/A | This feature touches no telemetry payload/retention logic — it changes which project's *already-governed* data a dashboard query is scoped to, not how that data is stored, logged, or retained. |
| X. Admin Mutations Are Recorded | Yes | **PASS** — project creation is explicitly named in Principle X's own rationale ("who rotated a DSN or removed a member") as exactly this kind of account-level mutation; `POST /api/internal/projects` writes `audit_log` (`action: "project.create"`) in the same transaction as the insert, matching every prior module's established pattern. |
| XI. English-Only, Conventional Commits | Yes | **PASS** — unchanged. |

No violations requiring the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/008-multi-project-support/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   └── projects-internal-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root, additions to Modules 1-7's existing tree)

```text
worker/
├── modules/
│   ├── projects/
│   │   ├── routes.ts          # + POST / (create), unchanged existing source-map route
│   │   └── resolve.ts         # new — resolveRequestedProject(db, requestedId): shared across
│   │                           #   every pillar module, constitution Principle V
│   ├── issues/routes.ts        # both routes gain WHERE project_id = ?, via resolve.ts
│   ├── traces/routes.ts        # hardcoded "demo" -> resolve.ts
│   ├── logs/routes.ts          # 2 hardcoded "demo" spots -> resolve.ts
│   ├── uptime/routes.ts        # module-level PROJECT_ID const -> resolve.ts, per-request
│   ├── releases/routes.ts      # 1 hardcoded "demo" spot (releasesInternalRoutes) -> resolve.ts
│   └── feedback/routes.ts      # module-level PROJECT_ID const -> resolve.ts, per-request

app/
├── lib/
│   └── use-selected-project.ts  # new — mirrors use-session.ts's pattern; sessionStorage-backed
├── shell/
│   ├── AppShell.tsx             # project chip -> real switcher when projects.length > 1
│   ├── SettingsScreen.tsx       # + project-creation form/section
│   └── (~9 other screens)       # existing fetch() calls gain ?project=${selectedProjectId}

tests/
├── unit/
│   └── resolve-project.test.ts  # resolveRequestedProject()'s 3 cases
├── contract/
│   └── projects-api.spec.ts     # create + real-DSN-isolation + per-route ?project= override
└── e2e/
    └── multi-project-switching.spec.ts
```

**Structure Decision**: Extends Modules 1-7's existing `worker/` + `app/` + `tests/` layout — no new
top-level directories, no new Cloudflare bindings, no migration. `worker/modules/projects/resolve.ts`
is the one new shared module this feature introduces, consistent with Principle V's existing
precedent (`worker/modules/ingest/dsn-auth.ts`, `release-lookup.ts` etc. are all prior examples of
exactly this "one shared helper, many pillar call sites" shape).

## Complexity Tracking

*No unresolved Constitution Check violations — table omitted.*
