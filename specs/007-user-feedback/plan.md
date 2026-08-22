# Implementation Plan: User Feedback

**Branch**: `007-user-feedback` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Status note**: Implemented and verified live — see tasks.md's Status line for the full test
summary. The one genuine surprise found during implementation: the real SDK's dialog request lands
on the TRAILING-SLASH path (`/api/embed/error-page/`), confirmed live via a real, unmodified
`@sentry/browser` bundle's actual `showReportDialog()` call — both the slash and no-slash forms are
mounted (research.md §6). This module's migration is `0007_user_feedback.sql`. **This was the last
module in the constitution's Product Scope & Module Roadmap** — all seven modules are now
implemented.

## Summary

Ship FlightDeck's user-feedback surface: a widget-based path (extends Module 2's existing envelope
endpoint with a new `"feedback"` item type — no new authentication, no new Cloudflare binding) and a
crash-report-dialog path (`GET|POST /api/embed/error-page`, a genuinely new HTML/JS-serving ingest
route, distinct in kind from every other module's JSON-only ingest work). Both paths converge on one
`Feedback` table, resolving `associated_event_id` against Module 2's existing `events.sdk_event_id`
to derive a denormalized `issue_id` for fast cross-linking from `IssueDetailScreen.tsx`. The
dialog's exact wire shape — the one item this session's earlier research had flagged as unconfirmed
— is now resolved with source-level confidence by reading Sentry's own `error_page_embed.py` and
`report-dialog.ts` directly (research.md §1): confirmed query params (`dsn`, `eventId`), confirmed
POST field names (`name`, `email`, `comments`), and a confirmed script-injection contract that
FlightDeck can satisfy with its own self-contained JS payload rather than replicating Sentry's
internal rendering mechanism.

## Technical Context

**Language/Version**: TypeScript (strict mode), Deno 2.x — unchanged from Modules 1-6.

**Primary Dependencies**: None new. No npm dependency required for either ingest path.

**Storage**: D1 only — no new Cloudflare bindings this module. One new table: `feedback`. No changes
to existing tables (unlike Module 5, this module denormalizes `issue_id` onto its own new table
rather than adding columns to `issues`/`events`).

**Testing**: `deno test` for pure-function units (feedback envelope-item parsing/dispatch,
`associated_event_id` → `issue_id` resolution including the not-found case, dedup logic for both the
envelope path and the dialog path's upsert). Contract tests against a real `wrangler dev` for the
envelope-based path (Module 2's established hand-crafted-request pattern) and for the crash-report
dialog's GET+POST pair (hand-crafted requests matching research.md §1's confirmed real wire shape).
`quickstart.md`'s Real-SDK validation step is reserved for human-run validation against an actual
`@sentry/browser` integration, matching Module 5's `sentry-cli`-in-quickstart precedent — spec.md's
SC-002 explicitly asks for real-SDK-grade confidence, which a hand-crafted contract test alone
cannot fully establish. Playwright e2e for the Feedback list/detail flow and issue↔feedback
cross-linking.

**Target Platform**: Cloudflare Workers, same production/preview split as Modules 1-6. No new
deployable unit.

**Performance Goals**: widget feedback appears in the dashboard within seconds of submission (spec
SC-001); the crash-report dialog loads, displays, and accepts submission against an unmodified real
SDK (SC-002); 100% of ingest requests with an invalid/unrecognized DSN are rejected with nothing
recorded (SC-003, both paths); feedback linked to an issue is visible from both the general list and
the issue's own detail view (SC-004); standalone feedback displays correctly as a normal case
(SC-005).

**Constraints**: no new rate-limit category — feedback ingest shares the existing per-DSN-key
`RateLimiter` shard unchanged (research.md §3 — confirmed the current implementation has no category
dimension at all yet, so this isn't a deferred feature, just consistency with what exists); the
crash-report dialog endpoint has no per-project allowed-origin check this module (research.md §1,
named explicitly as a narrower-than-Sentry's-own posture, not silently absent) — DSN validity
remains the load-bearing check (Principle III, unchanged fail-closed posture); ingest payload size
capped consistent with the existing `MAX_ENVELOPE_BYTES` posture (FR-010).

**Scale/Scope**: 1 new envelope item type (`feedback`) on the existing ingest endpoint, 1 new public
ingest route pair (`GET`/`POST /api/embed/error-page`) serving `text/javascript` rather than JSON —
the first non-JSON ingest response shape in the project, 1 new D1 table, 2 new/changed app-shell
screens (`FeedbackScreen.tsx`: static empty state → real list+detail, `IssueDetailScreen.tsx`:

- feedback section), no new Cloudflare bindings, no `wrangler.jsonc` change (research.md §2 — the
  new route is already covered by the existing `run_worker_first: ["/login", "/logout", "/api/*"]`
  wildcard).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                       | Applies to this module?                         | Gate status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Two Trust Surfaces                           | Yes                                             | **PASS** — both feedback ingest paths (envelope item, dialog GET/POST) are public, DSN-authenticated ingest (Principle III), never Access-gated; the new `/api/internal/feedback*` routes are control-plane, `sessionAuth`-gated, unchanged pattern from every prior module. No route serves both purposes.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| II. Defense-in-Depth (control plane)            | Yes                                             | **PASS** — new dashboard-facing feedback routes reuse `sessionAuth` unchanged, same fail-closed posture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| III. DSN-Key Authentication (ingest)            | Yes, for both new ingest paths                  | **PASS** — the envelope path reuses `extractSentryKey`/`resolveProjectByDsnKey` unmodified. The dialog path authenticates via the DSN embedded in its `dsn` query parameter (a different DSN _encoding_ — full DSN string vs. bare `sentry_key` — but the same underlying key-resolves-to-an-active-project fail-closed check, research.md §1); a missing/invalid/unresolvable DSN gets a `404`/`400`, never a degraded-but-permitted mode.                                                                                                                                                                                                                                                                                   |
| IV. Sentry Protocol Compatibility               | Yes — this module's central technical challenge | **PASS, verified against real Sentry source, not docs alone** — research.md §1 confirms the dialog's exact query params, POST field names, and same-URL GET/POST shape by reading `error_page_embed.py`/`report-dialog.ts` directly. The one deliberate, documented divergence: FlightDeck's GET response is a self-contained, FlightDeck-authored script rather than Sentry's own JSONP-comment-templated rendering — justified because the real SDK's compatibility contract (script loads successfully, `postMessage("__sentry_reportdialog_closed__")` on close) doesn't depend on matching Sentry's internal rendering mechanism, only on the confirmed external contract, which FlightDeck's version satisfies exactly. |
| V. Single Worker, One Module Per Pillar         | Yes                                             | **PASS** — feedback ingest logic extends the existing shared `worker/modules/ingest/` (envelope item dispatch, same as every prior module's item-type addition); the dialog route and dashboard-facing routes live in a new `worker/modules/feedback/` pillar module, matching every prior module's own control-plane-routes module.                                                                                                                                                                                                                                                                                                                                                                                          |
| VI. Deno-Only Local Toolchain                   | Yes                                             | **PASS** — no new npm dependency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| VII. One Configuration File                     | Yes                                             | **PASS** — no new Cloudflare binding, no `wrangler.jsonc` change at all (research.md §2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| VIII. Strict TypeScript, Test-First, Playwright | Yes                                             | **PASS by design** — see Testing above; the "how do we get SC-002-grade real-SDK confidence without a browser SDK dependency in automated CI" question is resolved the same way Module 5 resolved the analogous `sentry-cli`-in-CI question: hand-crafted contract tests in CI, real-SDK validation reserved for `quickstart.md`'s manual step.                                                                                                                                                                                                                                                                                                                                                                               |
| IX. Customer Telemetry Confidentiality          | Yes, narrowly                                   | **PASS** — feedback messages/contact info are customer telemetry (may contain PII, e.g. a submitted email address) subject to the same confidentiality discipline as Module 2's event payloads: no logging of feedback content, D1 access through the shared data-access pattern. This module introduces no new retention-window decision — feedback rows are low-volume, one-per-user-action data, closer in shape to Module 5's `release_health` (small, not high-frequency) than to Modules 2-4's raw high-volume telemetry; whether it needs its own pruning job is a tasks.md-level judgment call, not a load-bearing architecture decision.                                                                             |
| X. Admin Mutations Are Recorded                 | No                                              | **N/A** — this module introduces no new control-plane _mutation_ surface (feedback ingest is not an admin action; the dashboard-facing routes are read-only, `GET` only). No `audit_log` writes needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| XI. English-Only, Conventional Commits          | Yes                                             | **PASS** — unchanged, enforced by convention/review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

No violations requiring the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/007-user-feedback/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── feedback-ingest-api.md      # envelope item + crash-report dialog
│   └── feedback-internal-api.md    # dashboard-facing endpoints
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root, additions to Modules 1-6's existing tree)

```text
worker/
├── modules/
│   ├── ingest/
│   │   ├── envelope.ts         # + isFeedbackItem()
│   │   └── routes.ts           # + "feedback" item dispatch → feedback/ingest.ts
│   └── feedback/
│       ├── ingest.ts           # new — shared write path: envelope item → Feedback row,
│       │                       #   associated_event_id → issue_id resolution (research.md §3)
│       ├── dialog.ts           # new — GET/POST /api/embed/error-page (research.md §1)
│       │                       #   GET renders the self-contained JS payload; POST maps
│       │                       #   name/email/comments → Feedback, upserts (research.md §1)
│       └── routes.ts           # new — GET /api/internal/feedback[/:id], sessionAuth-gated
└── db/
    └── migrations/
        └── 0007_user_feedback.sql   # feedback table (data-model.md)

app/
├── shell/
│   ├── FeedbackScreen.tsx      # Module 1: static empty state → real list+detail
│   └── IssueDetailScreen.tsx   # (Module 2) + feedback section, shown only when non-empty

tests/
├── unit/
│   ├── feedback-ingest.test.ts       # envelope-item parsing/dispatch, associated_event_id
│   │                                  #   resolution (found + not-found cases), dedup
│   └── feedback-dialog.test.ts       # dialog request parsing, upsert-on-retry logic
├── contract/
│   └── feedback-api.spec.ts          # envelope path + dialog GET/POST, against wrangler dev
└── e2e/
    └── feedback-list-and-linking.spec.ts   # list/detail flow, issue↔feedback cross-linking
```

**Structure Decision**: Extends Modules 1-6's existing `worker/` + `app/` + `tests/` layout — no new
top-level directories, no new Cloudflare bindings. `worker/modules/feedback/` is a new pillar module
(dashboard routes + the dialog's HTML/JS-serving route), matching every prior module's own
control-plane-routes module; the envelope item-type dispatch extends the existing shared
`worker/modules/ingest/` for the same reason every prior module's new item type has.

## Complexity Tracking

_No unresolved Constitution Check violations — table omitted._
