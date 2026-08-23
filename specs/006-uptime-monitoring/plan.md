# Implementation Plan: Uptime Monitoring

**Branch**: `006-uptime-monitoring` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Status note**: Implemented and verified live — see tasks.md's Status line for the full test
summary. Two real bugs were found and fixed during contract testing against a real `wrangler dev`
(research.md §10): a `DELETE /checks/:id` FK-constraint failure (`check_runs`/`incidents` both
reference `checks(id)`, so cascading the delete is required, not just an incident-resolve-then-
delete-check sequence), and a `PATCH /checks/:id` bug that silently wiped `webhookUrl` to null on
any partial update that didn't explicitly re-send it. This module's migration is
`0006_uptime_monitoring.sql`.

## Summary

Ship FlightDeck's first synthetic-monitoring surface: configurable HTTP/TCP checks, run on a
schedule and on demand through one shared evaluation function (constitution Principle V's first real
consumer, mirroring FlareTower's confirmed `runEvaluation(env, trigger)` pattern exactly), with
incident-aware alerting (N-consecutive-failures-open-one-incident, M-consecutive-recoveries-
auto-resolve — the standard SRE pattern, not a novel invention) surfaced in Module 1's existing
Alerts screen plus an optional per-check webhook. This module has markedly less Sentry-protocol
grounding than Modules 2-5 and says so plainly. It also carries this session's first genuine,
investigated-and-confirmed deviation from the constitution's literal wording: Cloudflare Workers
have no controllable execution region for scheduled checks, so this module ships single-region for
MVP rather than the constitution's "multi-region" phrasing — documented explicitly in the
Constitution Check and Complexity Tracking below, not silently absorbed.

## Technical Context

**Language/Version**: TypeScript (strict mode), Deno 2.x — unchanged from Modules 1-5.

**Primary Dependencies**: No new npm dependency. TCP checks use the Workers runtime's built-in
`cloudflare:sockets` module (research.md §2) — a platform API, not a package.

**Storage**: D1 only. New tables: `checks`, `check_runs`, `incidents` (data-model.md). No new R2/
Queue/Durable Object bindings — this module's write volume (bounded by the 60s/20-checks-per-project
limits, research.md §4-5) stays well within direct-D1-write territory, the same MVP posture Module 2
and Module 5 both used.

**Testing**: `deno test` for the shared `runCheck()` evaluation logic's pure decision-making
(consecutive-failure/recovery counting, incident transitions) with network I/O mocked — the highest-
value test target in this module; a dedicated test proving the scheduled and interactive code paths
genuinely invoke the same function with identical resulting state for identical inputs (research.md
§8 — this module's actual Principle V compliance proof). Contract tests against a real
`wrangler
dev` for check-creation → manual-trigger → incident-open/resolve, and for webhook delivery
(a request-capturing test endpoint). Playwright e2e for the Uptime/Alerts UI flow.

**Target Platform**: Cloudflare Workers, same production/preview split as Modules 1-5. No new
deployable unit — a second `triggers.crons` entry on the existing Worker.

**Performance Goals**: A configured check shows real status within one scheduled interval, no manual
intervention (spec SC-001); a sustained outage produces exactly one incident (spec SC-002); an
incident auto-resolves within one recovery-threshold's worth of successful checks (spec SC-003).

**Constraints**: 60-second minimum check interval, 20-check-per-project maximum (research.md §4 —
real abuse-prevention reasoning, since this module makes FlightDeck an outbound requester against
arbitrary third-party targets, a different risk shape than DSN-authenticated ingest); `check_runs`
retention MUST default to a bounded window (constitution Principle IX's spirit, applied here even
though this isn't customer-submitted telemetry — 30 days, research.md §5); webhook delivery MUST NOT
block or corrupt incident state on failure (spec FR-011, research.md §7's single-attempt, no-retry
design).

**Scale/Scope**: 1 new scheduled-handler consumer of Principle V's shared-evaluation-logic rule
(this module's central architectural requirement), 3 new D1 tables, 1 new `worker/modules/uptime/`
pillar module, 2 real app-shell screens (Uptime, Alerts) replacing Module 1's static empty states
plus 1 new `CheckDetailScreen.tsx`, 1 extension to the existing retention job.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                       | Applies to this module?                             | Gate status                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Two Trust Surfaces                           | Yes                                                 | **PASS** — all new routes (check CRUD, manual trigger, incident listing) are dashboard-facing and `sessionAuth`-gated; this module introduces no ingest/DSN-authenticated surface at all — it's purely control-plane.                                                                                                                                       |
| II. Defense-in-Depth (control plane)            | Yes                                                 | **PASS** — reuses `sessionAuth` unchanged.                                                                                                                                                                                                                                                                                                                  |
| III. DSN-Key Authentication (ingest)            | N/A                                                 | This module has no ingest surface — no DSN-authenticated endpoint is added or touched.                                                                                                                                                                                                                                                                      |
| IV. Sentry Protocol Compatibility               | N/A, stated explicitly rather than silently skipped | This module is NOT Sentry-protocol-compatible in the way Modules 2-5 are — Sentry's real Uptime Monitoring product exists but its wire protocol isn't public (research.md §9). Not a gate failure; a genuine difference in kind, named plainly per this plan's Summary.                                                                                     |
| V. Single Worker, One Module Per Pillar         | Yes — this module's central requirement             | **PASS by design, proof-by-construction required**: `runCheck(env, checkId, trigger)` (research.md §8) is the single shared evaluation function both the scheduled cron case and the interactive "test now" route call — mirroring FlareTower's confirmed pattern exactly. A dedicated test (not just code review) verifies this holds, per research.md §8. |
| VI. Deno-Only Local Toolchain                   | Yes                                                 | **PASS** — `cloudflare:sockets` is a Workers runtime built-in, not an npm dependency; no new tooling.                                                                                                                                                                                                                                                       |
| VII. One Configuration File                     | Yes                                                 | **PASS** — one new `triggers.crons` entry in the existing `wrangler.jsonc`; no new config file, no new binding type.                                                                                                                                                                                                                                        |
| VIII. Strict TypeScript, Test-First, Playwright | Yes                                                 | **PASS by design** — see Testing above; the Principle V proof-by-construction test is this module's highest-priority test, written and verified before other work proceeds per tasks.md's Foundational phase.                                                                                                                                               |
| IX. Customer Telemetry Confidentiality          | Applies in spirit, not literally                    | `check_runs` isn't customer-submitted telemetry (it's FlightDeck's own synthetic-check results), but gets a bounded retention window anyway (research.md §5) for the same operational-hygiene reasons Modules 3-5 applied to genuinely high-frequency data — a proportionate, not literal, application of the principle.                                    |
| X. Admin Mutations Are Recorded                 | Yes                                                 | **PASS** — check creation/edit/deletion are admin mutations on project configuration and MUST write `audit_log` entries, matching every prior module's precedent.                                                                                                                                                                                           |
| XI. English-Only, Conventional Commits          | Yes                                                 | **PASS** — unchanged.                                                                                                                                                                                                                                                                                                                                       |

**One documented, justified deviation** — see Complexity Tracking below. Every other principle
passes without qualification.

## Project Structure

### Documentation (this feature)

```text
specs/006-uptime-monitoring/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   └── uptime-internal-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root, additions to Modules 1-5's existing tree)

```text
wrangler.jsonc              # + a second triggers.crons entry ("* * * * *", both envs) alongside
                             #   Module 2's existing retention cron

worker/
├── index.ts                 # scheduled() gains an uptime-check case: query due checks, call
│                             #   runCheck() for each, update next_run_at
├── modules/
│   ├── uptime/
│   │   ├── evaluate.ts         # runCheck(env, checkId, trigger) — the single shared evaluation
│   │   │                       #   function (research.md §8); HTTP fetch / cloudflare:sockets
│   │   │                       #   TCP connect, consecutive-failure/recovery counting, incident
│   │   │                       #   open/resolve, webhook delivery (fire-and-forget, research.md §7)
│   │   └── routes.ts           # sessionAuth-gated: check CRUD, manual-trigger endpoint (calls
│   │                           #   evaluate.ts with trigger: "interactive"), incident listing
│   └── ingest/
│       └── retention.ts        # + prunes check_runs rows past their own 30-day window
│                                #   (research.md §5)
└── db/
    └── migrations/
        └── 0006_uptime_monitoring.sql  # checks, check_runs, incidents

app/
└── shell/
    ├── UptimeScreen.tsx        # Module 1: static empty state → real check list
    ├── CheckDetailScreen.tsx    # new — run history, incidents, "test now" button
    └── AlertsScreen.tsx         # Module 1: static empty state → real incident list

tests/
├── unit/
│   ├── uptime-evaluate.test.ts     # runCheck()'s pure decision logic (network I/O mocked)
│   └── uptime-shared-path.test.ts   # Principle V proof-by-construction (research.md §8)
├── contract/
│   └── uptime-checks.spec.ts        # against real wrangler dev: create → manual-trigger →
│                                     #   incident-open/resolve, webhook delivery
└── e2e/
    └── uptime-and-alerts.spec.ts     # Uptime/Alerts UI flow
```

**Structure Decision**: Extends Modules 1-5's existing `worker/` + `app/` + `tests/` layout — no new
top-level directories, no new Cloudflare bindings beyond a second cron entry on the existing
mechanism. `worker/modules/uptime/` is a new pillar module, consistent with every prior module's own
control-plane-routes module; `evaluate.ts` is deliberately separate from `routes.ts` so the shared
evaluation function has no dependency on Hono/routing context, keeping it equally callable from the
`scheduled()` handler (which has no Hono context at all) and from an HTTP route handler.

## Complexity Tracking

> Filled because this module has a real Constitution Check deviation — see research.md §1 for the
> full investigation.

| Violation                                                                   | Why Needed                                                                                                                                                                             | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single-region checks, not the constitution's literal "multi-region" wording | Cloudflare Workers Cron Triggers have no documented API to select or pin execution region (research.md §1) — this is a genuine platform capability gap, not an implementation shortcut | Cloudflare's own native Health Checks/Load Balancing were investigated and rejected: wrong shape (origin-on-a-zone monitoring, not arbitrary third-party URLs) AND wrong tier (paid, conflicting with the free-tier/self-hostable posture every prior module protected). External third-party check infrastructure was also considered and rejected as out of this module's architectural scope (a single Cloudflare Worker, per Principle V). Shipping single-region, honestly labeled, was the only option that didn't either misrepresent the feature or abandon the project's established platform/cost posture. |
