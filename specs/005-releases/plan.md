# Implementation Plan: Releases

**Branch**: `005-releases` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Status note**: Implemented. Module 2's tables/GitHub App infrastructure this plan referenced were
already real, live code, not planned-only artifacts, exactly as anticipated. This module's
migration, `0005_releases.sql`, applied cleanly on top of Modules 2-3's schema.

## Summary

Ship FlightDeck's release-management surface, with a hard, constitution-level requirement (Principle
IV): `sentry-cli`, unmodified, pointed at FlightDeck via its standard `SENTRY_URL` override, must be
able to create a release, upload its source maps, finalize it, associate commits, and record
deploys — the full command surface, not a reduced core flow. This requires a new authentication
mechanism (project-scoped Bearer API tokens, reasoned explicitly as an extension of the existing
control-plane trust surface, not a third one) and resolves a real protocol tension (FlightDeck has
no organizations concept, but sentry-cli's release-creation endpoint is org-scoped) via a researched,
documented accommodation rather than inventing multi-org support. Release health (adoption,
crash-free sessions/users) is ingested through the same envelope endpoint as a 4th distinct item
type (`"session"`/`"sessions"`), written directly to D1 (no Queue — SDK-side pre-aggregation keeps
volume down), with a deliberately bounded, capped approach to distinct-user counting rather than an
unbounded table or an unimplemented probabilistic sketch. Regression detection extends Module 2's
existing error-ingest path, and requires adding the minimum viable issue-resolution concept Module 2
explicitly deferred — bare resolve, two modes, no ignore/snooze/assignment.

## Technical Context

**Language/Version**: TypeScript (strict mode), Deno 2.x — unchanged from Modules 1-4.

**Primary Dependencies**: No new npm dependency. API token hashing uses Web Crypto (already used by
`worker/auth/session.ts`/`worker/auth/access-jwt.ts` via `jose`) — no new crypto library needed for
a salted-hash-and-compare scheme.

**Storage**: D1 only — no new Cloudflare bindings this module (unlike Modules 3-4's Queues/Durable
Objects). New tables: `api_tokens`, `release_commits`, `deploys`, `release_health`,
`release_health_users`; additive columns on the EXISTING `releases` and `issues` tables (Module 2).

**Testing**: `deno test` for pure-function units (release-health aggregation, regression-detection
release-ordering comparison, API-token hash/verify, sentry-cli endpoint request-shape parsing);
contract tests against a real `wrangler dev` using hand-crafted HTTP requests matching sentry-cli's
confirmed wire format (research.md §8 — not a real `sentry-cli` binary dependency in automated CI);
Playwright e2e for the Releases list→detail flow and the issue-resolve action; `quickstart.md`'s
manual validation step uses a REAL `sentry-cli` installation for genuine end-to-end confidence,
reserved for human-run validation rather than automated CI (research.md §8).

**Target Platform**: Cloudflare Workers, same production/preview split as Modules 1-4. No new
deployable unit.

**Performance Goals**: An unmodified `sentry-cli` release flow completes successfully with only an
endpoint/token change (spec SC-001); a release's adoption/crash-free figures are numerically correct
against a known ingested distribution (spec SC-002); regression detection correctly fires/doesn't
fire across both resolution modes (spec SC-004).

**Constraints**: API tokens are project-scoped (research.md §4, matching sentry-cli's own
`SENTRY_PROJECT` usage), fail-closed on missing/invalid/revoked (constitution Principle III's
posture, applied to this control-plane-adjacent mechanism); every release-management action via a
token is `audit_log`-recorded (Principle X); the `org_slug` URL segment is accepted but never
validated (Principle IV's documented, necessary divergence, research.md §3); release-health data is
customer telemetry subject to the same confidentiality discipline as Module 2's event payloads
(Principle IX) — though note this module does not introduce its own NEW retention window, since
`release_health` rows are small daily aggregates, not raw per-event data; whether they need pruning
at all (versus keeping indefinitely, given their low storage cost per row) is a judgment call for
tasks.md's polish phase, not a load-bearing architecture decision the way Modules 3-4's retention
was.

**Scale/Scope**: 1 new envelope item type (`session`/`sessions`) on the existing ingest endpoint, 1
new auth mechanism (API tokens) + middleware, 1 new `worker/modules/releases/` route module
implementing 7 sentry-cli-compatible endpoints, 5 new D1 tables + additive columns on 2 existing
tables, 2 new/changed app-shell screens (Releases list, new Release Detail) plus small additions to
`SettingsScreen.tsx` and `IssueDetailScreen.tsx`, 1 extension to Module 2's existing error-ingest
path (regression detection).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate status |
|---|---|---|
| I. Two Trust Surfaces | Yes — this module's central compliance question | **PASS, reasoned explicitly, not assumed** — API tokens (research.md §4) are analyzed in depth as an extension of the control-plane trust surface's authorization (human-account-backed, just carried as a Bearer token for non-browser CI/CD clients), NOT a third surface and NOT the DSN-ingest mechanism (which stays deliberately anonymous/public). The distinction is load-bearing and documented, not glossed over. |
| II. Defense-in-Depth (control plane) | Yes | **PASS** — new dashboard-facing routes (release list/detail, API token generation, issue resolve) reuse `sessionAuth` unchanged; the new sentry-cli-facing routes use the new `apiTokenAuth` middleware, fail-closed on the same principle `sessionAuth` already applies. |
| III. DSN-Key Authentication (ingest) | Yes, for the session-ingest path only | **PASS** — `"session"`/`"sessions"` envelope items go through the exact same DSN-auth step as `event`/`transaction`/`log` items, unmodified. The NEW `apiTokenAuth` mechanism is a control-plane concern (Principle I/II), not an ingest concern — release-management actions are never DSN-authenticated. |
| IV. Sentry Protocol Compatibility | Yes — this module is where Principle IV's release/source-map CLI requirement is actually discharged | **PASS by design, with a documented divergence**: the full confirmed `sentry-cli` command surface (research.md §1) is implemented against verified real endpoint shapes, not invented ones. The `org_slug` pass-through (research.md §3) is the one necessary divergence, explicitly named and justified — FlightDeck has no organizations feature and isn't building one for this module, but still satisfies every operation's actual request/response contract. |
| V. Single Worker, One Module Per Pillar | Yes | **PASS** — sentry-cli-facing release routes live in a new `worker/modules/releases/` (their own pillar, distinct from `issues`/`traces`/`logs`, matching how each prior module's control-plane routes got their own module); release-health ingest logic extends `worker/modules/ingest/` for the same reason session data shares the envelope endpoint by protocol design. |
| VI. Deno-Only Local Toolchain | Yes | **PASS** — no new npm dependency; API-token hashing uses Web Crypto already in use. |
| VII. One Configuration File | Yes | **PASS** — no new bindings at all this module; nothing to add to `wrangler.jsonc` beyond (if needed) documentation of the new `api_tokens` table existing, which isn't a binding-level change. |
| VIII. Strict TypeScript, Test-First, Playwright | Yes | **PASS by design** — see Testing above; the sentry-cli-in-CI feasibility question (research.md §8) was investigated and resolved explicitly, not left as an unstated gap. |
| IX. Customer Telemetry Confidentiality | Yes, narrowly | **PASS** — release-health data (session/crash counts) is customer telemetry like Module 2's event payloads, but is small, pre-aggregated, daily-granularity data, not raw per-event content — whether it needs its own bounded-retention job is a tasks.md-level judgment call, not a compliance gap (unlike Modules 3-4, where raw high-volume data made retention load-bearing from the start). |
| X. Admin Mutations Are Recorded | Yes | **PASS** — API token generation/revocation and issue resolution are new admin mutations and MUST write `audit_log` entries, matching Module 2's GitHub-connect/source-map-upload precedent exactly. Release creation/upload/finalize/set-commits/deploy via an API token are ALSO admin mutations in substance (they modify project data on behalf of an account) and get the same treatment, attributing the token's owning account as actor. |
| XI. English-Only, Conventional Commits | Yes | **PASS** — unchanged, enforced by convention/review. |

No violations requiring the Complexity Tracking table — Principle I's central question (API tokens)
is reasoned through as compliant by design, not carried forward as a tracked exception.

## Project Structure

### Documentation (this feature)

```text
specs/005-releases/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── release-management-api.md    # sentry-cli-compatible endpoints
│   └── releases-internal-api.md     # dashboard-facing endpoints
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root, additions to Modules 1-4's existing tree)

```text
worker/
├── auth/
│   └── api-token.ts          # new — token generation/hashing/verification, mints/checks
│                             #   against api_tokens (research.md §4)
├── modules/
│   ├── ingest/
│   │   ├── envelope.ts         # + isSessionItem() alongside existing item-type checks
│   │   ├── routes.ts           # + "session"/"sessions" dispatch → release-health.ts
│   │   │                       # + regression-detection check in the existing "event" path
│   │   ├── release-health.ts   # new — pure aggregation: session outcomes → daily UPSERT
│   │   └── regression.ts       # new — pure release-ordering comparison (research.md §7)
│   ├── releases/
│   │   └── routes.ts           # new — apiTokenAuth-gated sentry-cli-compatible endpoints
│   │                           #   (research.md §1, §3)
│   └── issues/
│       └── routes.ts           # (Module 2) + POST /:id/resolve
└── db/
    └── migrations/
        └── 0005_releases.sql   # api_tokens, release_commits, deploys, release_health,
                                 # release_health_users; + releases.date_released/ref/url,
                                 # + issues.status/resolved_release_id/resolved_mode

app/
├── shell/
│   ├── ReleasesScreen.tsx      # Module 1: static empty state → real list
│   ├── ReleaseDetailScreen.tsx  # new — per-environment health, commits, deploys, regressed issues
│   ├── IssueDetailScreen.tsx    # (Module 2) + resolve action, regressed indicator
│   └── SettingsScreen.tsx       # (Module 2/4) + API token management section

tests/
├── unit/
│   ├── release-health.test.ts       # aggregation function
│   ├── regression.test.ts            # release-ordering comparison, both resolution modes
│   └── api-token.test.ts             # hash/verify logic
├── contract/
│   └── release-management-api.spec.ts   # hand-crafted requests matching sentry-cli's real
│                                          #   wire format (research.md §8), against wrangler dev
└── e2e/
    └── releases-and-resolve.spec.ts       # list→detail flow, issue-resolve action
```

**Structure Decision**: Extends Modules 1-4's existing `worker/` + `app/` + `tests/` layout — no new
top-level directories, no new Cloudflare bindings. `worker/modules/releases/` is a new pillar module
(sentry-cli-facing), consistent with every prior module's own control-plane-routes module;
release-health/regression logic extends `worker/modules/ingest/` for the same shared-envelope-
endpoint reason Modules 3-5 all extend it rather than building a parallel ingest surface.

## Complexity Tracking

*No unresolved Constitution Check violations — table omitted.*
