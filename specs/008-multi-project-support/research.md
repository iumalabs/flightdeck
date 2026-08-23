# Research: Multi-Project Support

Consolidates this session's direct codebase investigation (not assumption) into the exact current
state this feature must change, plus the scoping-mechanism decision the spec deliberately left open.

## 1. Scoping mechanism: `?project=<id>` query parameter, not a path segment or header

**Decision**: every dashboard-facing internal route reads the target project from a `?project=<id>`
query parameter, defaulting to the workspace's first project (by `created_at ASC`) when omitted.

**Rationale**: a path segment (`/api/internal/:project/issues`) would require restructuring the URL
of every route across 6 pillar modules for no functional benefit over a query param — Hono resolves
either equally well, and the query-param form is a strictly smaller diff. A header was rejected for
practical testability: every contract test in this project (Modules 2-7) drives requests via
Playwright's `request` fixture or hand-crafted `fetch`/`curl`, and query params are trivially visible
in a request URL during debugging in a way a custom header is not; there's also no existing
precedent for a custom internal header anywhere in this codebase to extend consistently.

**Default-project rule, confirmed against existing behavior**: `GET /api/internal/projects` already
returns rows `ORDER BY created_at ASC`, and every frontend screen that currently reads `projects[0]`
(`AppShell.tsx`, `SettingsScreen.tsx`) already implicitly treats "first by creation order" as "the"
project. The fallback this feature introduces (`?project=` omitted → first project by the same
ordering) is not a new convention — it's making that already-implicit assumption explicit and
authoritative, which is exactly what keeps a single-project workspace's behavior unchanged (spec
FR-009): with one project, "first by creation order" and "the only project" are the same row.

## 2. The authoritative list of hardcoded-"demo" call sites — confirmed by direct grep, not a hand-maintained list

```
worker/modules/traces/routes.ts:34:    const projectId = "demo";
worker/modules/feedback/routes.ts:16:  const PROJECT_ID = "demo";
worker/modules/uptime/routes.ts:21:   const PROJECT_ID = "demo";
worker/modules/logs/routes.ts:91:     const projectId = "demo";
worker/modules/logs/routes.ts:126:    const projectId = "demo";
worker/modules/releases/routes.ts:373: const projectId = "demo";
```

**Additional finding beyond the hardcoded-constant pattern**: `worker/modules/issues/routes.ts`'s
`GET /` and `GET /:id` have NO project filter in their SQL at all (not even a hardcoded value) —
these query every project's issues indiscriminately. This is the one call site that needs an actual
new `WHERE project_id = ?` clause added, not just a constant-to-variable swap.

**Explicitly NOT in scope for this pass**: `worker/modules/logs/routes.ts`'s export-credential routes
(`:145`, `:212`) already read `projectId` from a URL path param (`c.req.param("id")`), not a
hardcoded constant — these are already per-project-aware and need no change. Confirmed by direct
inspection, not assumed from the constant-name grep alone.

## 3. DSN generation: reuse migration 0002's exact expression, not a new scheme

**Decision**: `POST /api/internal/projects` generates `dsn_public_key` via
`lower(hex(randomblob(16)))` — the identical SQL expression `0002_error_monitoring.sql` already uses
to backfill "demo"'s own key, executed as part of the same `INSERT` rather than computed in
JavaScript and passed in. `idx_projects_dsn_public_key`'s existing `UNIQUE` constraint (also from
migration 0002) is the actual collision guarantee — 128 bits of randomness makes a real collision
practically impossible, and the unique index turns "practically impossible" into "impossible without
an error," consistent with how the codebase already treats this value everywhere else.

**Full DSN string construction**: `https://{dsn_public_key}@{host}/{project_id}`, matching
`worker/modules/feedback/dialog.ts`'s existing `parseDsn()` — the same shape already parsed
elsewhere in this codebase, so the string this endpoint returns is guaranteed consistent with what
every other DSN-consuming code path expects. `{host}` is derived from the request's own URL
(`new URL(c.req.url).host`) at response time, not hardcoded to the production domain
(`flightdeck.iuma.dev`, confirmed from `wrangler.jsonc`'s `routes` config) — this keeps the returned
DSN correct in local/preview environments too, where the host differs.

## 4. Frontend state: `sessionStorage`, mirroring the existing `use-session.ts` pattern

**Decision**: the selected project id lives in `sessionStorage` (not `localStorage`, not React
context alone) behind a new `app/lib/use-selected-project.ts` hook, structurally mirroring the
existing `app/lib/use-session.ts`'s shape (a hook other components import, not a copy-pasted
`useState` + manual storage read in each screen).

**Rationale**: spec FR-007 requires the selection to survive navigation within a session but sets no
requirement to survive a browser restart — `sessionStorage`'s exact lifetime (cleared on tab close)
matches this precisely without over-persisting a per-tab UI preference into `localStorage`, which
this codebase has never used for this kind of state (confirmed: no existing `localStorage` usage
anywhere in `app/`).

## 5. No `[NEEDS CLARIFICATION]` markers remain

Every technical decision this plan required was already resolved either by direct codebase
investigation (§1-3 above) or by the project owner's explicit scoping brief before planning began —
none required a fresh clarification question.
