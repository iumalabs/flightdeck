# Implementation Plan: Error Monitoring

**Branch**: `002-error-monitoring` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-error-monitoring/spec.md`

**Status note**: Planned per explicit user instruction ("начни планировать Module 2"). Unlike
Module 1, this plan does not carry implementation authorization by default — `tasks.md` is produced
for review, but starting implementation is a separate decision.

## Summary

Ship FlightDeck's first real data-plane surface: a Sentry-envelope-compatible ingest endpoint
(`POST /api/{project_id}/envelope/`, DSN-key authenticated, publicly reachable per constitution
Principle I) accepting events from unmodified `@sentry/browser`-family and `sentry-sdk` (Python)
SDKs; automatic issue grouping (source-map-aware fingerprinting); a real Issues list and new Issue
Detail screen replacing Module 1's static empty state; source map upload/resolution (R2-backed,
FlightDeck's own minimal shape, not full sentry-cli compatibility — that's Module 5); and
suspect-commit lookups via a GitHub App connection. Introduces two new bindings beyond Module 1's
D1-only setup: an R2 bucket (source map storage) and a Durable Object class (per-DSN rate limiting).
Also closes a constitution compliance gap discovered mid-planning: Principle IX's bounded-retention
requirement, via a new scheduled Cron Trigger handler.

## Technical Context

**Language/Version**: TypeScript (strict mode), Deno 2.x — unchanged from Module 1.

**Primary Dependencies**: Everything from Module 1's `deno.json`, plus `@jridgewell/trace-mapping`
(source map resolution — provisional pending research.md §6's spike) and the `jose` library already
present (reused for GitHub App JWT signing, research.md §10 — no new JWT dependency needed).

**Storage**: D1 (existing databases, new tables — see data-model.md), plus a new R2 bucket
(`SOURCE_MAPS`) for source map file content, plus one Durable Object class (`RateLimiter`, one
instance per DSN key) for ingest rate limiting.

**Testing**: `deno test` for pure-function units (fingerprinting, envelope parsing, DSN resolution,
source-map VLQ resolution once research.md §6's spike lands) with no bindings required; contract
tests against a running `wrangler dev` using hand-crafted envelope bodies matching research.md §1's
exact grammar (not a full SDK install in the test harness — see research.md's testing rationale);
Playwright for the issue-list → issue-detail UI flow using Module 1's pre-authenticated-context
pattern plus seeded D1 data.

**Target Platform**: Cloudflare Workers, same production/preview split as Module 1. Ingest is public
on the same custom domain (`flightdeck.iuma.dev`) — no separate ingest subdomain.

**Project Type**: Extends Module 1's single-Worker web application — no new deployable unit.

**Performance Goals**: First-event-to-visible-issue under 30s (spec SC-001); accurate counts under
sustained early-stage-product volume with no observable backlog (spec SC-006) — direct D1 writes,
no Queue, per research.md §9's threshold reasoning.

**Constraints**: DSN-key auth fail-closed on every ingest request (constitution Principle III); the
control-plane additions this module makes (issues list, source map upload, GitHub connect) stay
sessionAuth-gated (Principle II), never DSN-gated; ingest MUST NOT be reachable via `/api/internal/*`
routing or vice versa (research.md §3); event retention MUST default to a bounded window
(Principle IX — see research.md §8's mid-planning correction).

**Scale/Scope**: 1 new ingest endpoint, ~6 new D1 tables, 1 new R2 bucket, 1 new Durable Object
class, 2 new/changed app-shell screens (Issues real data, new Issue Detail), 1 new scheduled
handler (retention), 1 new control-plane sub-area (GitHub connection, likely living on/near
SettingsScreen).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate status |
|---|---|---|
| I. Two Trust Surfaces | Yes — this is the module that makes it real | **PASS by design** — ingest (`/api/{project_id}/envelope/`) is public, DSN-keyed; every control-plane addition this module makes stays behind `sessionAuth`. research.md §3 makes the routing split explicit and testable rather than accidental. |
| II. Defense-in-Depth (control plane) | Yes | **PASS** — new control-plane routes (`GET /api/internal/issues`, source map upload, GitHub connect) reuse the existing `sessionAuth` middleware unchanged from Module 1. |
| III. DSN-Key Authentication (ingest) | Yes — first module to implement it | **PASS by design** — `X-Sentry-Auth` header and query-param DSN resolution, fail-closed on any missing/unknown/mismatched key (research.md §1), plus per-DSN rate limiting (research.md §4) so a compromised/leaked key can't exhaust shared capacity. |
| IV. Sentry Protocol Compatibility | Yes — central to this module | **PASS with documented, deliberate divergences**: no `/store/` endpoint (research.md §1, not needed for the two target SDKs' current versions), source map upload uses FlightDeck's own minimal shape rather than sentry-cli's org-slug-based endpoint (research.md §7, explicitly scoped to Module 5 by the constitution itself). Both divergences are named and justified, not silent. |
| V. Single Worker, One Module Per Pillar | Yes | **PASS** — new `worker/modules/ingest/` pillar; fingerprinting lives inside it for now (research.md §5) since no second pillar needs it yet, matching the "shared only when actually shared" reading of the principle. |
| VI. Deno-Only Local Toolchain | Yes | **PASS** — `@jridgewell/trace-mapping` added via `npm:` specifier in `deno.json`, no new tooling outside Deno. |
| VII. One Configuration File | Yes | **PASS** — new R2/DO bindings added to the existing `wrangler.jsonc`; no new config file. |
| VIII. Strict TypeScript, Test-First, Playwright | Yes | **PASS by design** — see Testing above; fingerprinting/parsing/DSN-resolution/source-map-VLQ are all pure-function-testable without bindings, satisfying test-first for the highest-risk logic first. |
| IX. Customer Telemetry Confidentiality | Yes — first module actually holding telemetry | **PASS, with a correction made during planning**: this module is where Principle IX stops being abstract — raw customer stack traces/breadcrumbs/vars land in D1 for the first time. The bounded-retention requirement was initially drafted as "flagged, not solved" and corrected to an actual scheduled retention job (research.md §8) once the gate was re-read carefully — recorded here so the correction itself is visible, not just its outcome. GitHub App private key is the only new secret, Worker-secret-only, never per-project (research.md §10). |
| X. Admin Mutations Are Recorded | Yes, narrowly | **PASS** — connecting/disconnecting a GitHub repository is an admin action on the project and MUST write an `audit_log` entry (actor, before/after) per the existing Module 1 identity model; uploading a source map is arguably also an admin action worth auditing — included for consistency rather than left ambiguous. Ingest itself (SDK writing events) is explicitly NOT an admin mutation and does NOT get audit-logged per-event (constitution Principle X's own carve-out: "not a duplicate of the event store"). |
| XI. English-Only, Conventional Commits | Yes | **PASS** — unchanged, enforced by convention/review. |

No violations requiring the Complexity Tracking table — the one real compliance gap found
(Principle IX retention) was corrected within this planning pass rather than shipped as a tracked
exception.

## Project Structure

### Documentation (this feature)

```text
specs/002-error-monitoring/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── ingest-api.md
│   └── internal-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root, additions to Module 1's existing tree)

```text
wrangler.jsonc              # + R2 bucket binding (SOURCE_MAPS), + Durable Object binding (RATE_LIMITER)
                             # + a `scheduled` cron trigger entry (daily retention job)

worker/
├── index.ts                 # + mounts ingestRoutes as a sibling to identityRoutes (research.md §3)
│                             # + scheduled() handler added (was fetch-only in Module 1)
├── durable-objects/
│   └── rate-limiter.ts       # RateLimiter DO class — one instance per DSN key (research.md §4)
├── modules/
│   ├── ingest/
│   │   ├── routes.ts          # POST /api/:projectId/envelope/ — DSN auth, envelope parse, rate limit
│   │   ├── envelope.ts         # envelope grammar parser (research.md §2)
│   │   ├── fingerprint.ts      # pure functions — fingerprinting (research.md §5)
│   │   ├── sourcemap.ts        # @jridgewell/trace-mapping resolution (research.md §6)
│   │   └── retention.ts        # scheduled-handler-invoked pruning (research.md §8)
│   ├── issues/
│   │   └── routes.ts           # GET /api/internal/issues, GET /api/internal/issues/:id (sessionAuth)
│   └── github/
│       ├── app-auth.ts          # App JWT signing + installation-token exchange (research.md §10)
│       └── routes.ts             # connect/disconnect repo, suspect-commit lookup (sessionAuth)
└── db/
    └── migrations/
        └── 0002_error_monitoring.sql  # projects.dsn_public_key, issues, events, releases,
                                        # source_maps, repository_connections

app/
├── shell/
│   ├── IssuesScreen.tsx       # Module 1: static empty state → real list, fetches /api/internal/issues
│   └── IssueDetailScreen.tsx   # new — stack trace, breadcrumbs, context, suspect commit
├── shell/AppShell.tsx          # + selectedIssueId state (research.md §11), routes to IssueDetailScreen
└── shell/SettingsScreen.tsx    # Module 1: identity-only → + GitHub connect UI, + source map upload UI

tests/
├── unit/
│   ├── envelope.test.ts
│   ├── fingerprint.test.ts
│   ├── dsn-auth.test.ts
│   ├── sourcemap-resolve.test.ts   # depends on research.md §6's spike outcome
│   └── github-app-auth.test.ts
├── contract/
│   └── ingest-envelope.spec.ts     # against real wrangler dev, hand-crafted envelope bodies
└── e2e/
    └── issues-list-and-detail.spec.ts
```

**Structure Decision**: Extends Module 1's existing `worker/` + `app/` + `tests/` layout — no new
top-level directories beyond `worker/durable-objects/` (a natural home for the one new DO class) and
`tests/contract/` (a new test tier this module introduces because ingest's wire-format correctness
is exactly the kind of thing that needs testing against a real running Worker, not just pure
functions — unit tests alone can't catch a routing/binding-level mistake in the actual envelope
endpoint).

## Complexity Tracking

*No unresolved Constitution Check violations — table omitted. (The one gap found, Principle IX
retention, was corrected during planning rather than carried forward as a tracked exception — see
the Constitution Check table above.)*
