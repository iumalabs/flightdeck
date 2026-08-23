# Internal API Contract: Multi-Project Support

Control-plane (constitution Principle I), `sessionAuth`-gated, unchanged from every prior module.

## `POST /api/internal/projects` (new)

**Request**: `{ "name": "string" }`.

**Behavior**: rejects an empty/missing `name` with `400`. Generates `dsn_public_key` via
`lower(hex(randomblob(16)))` (research.md §3), writes `audit_log` (`action: "project.create"`) in
the same transaction as the insert.

**Response `201`**:
```json
{ "id": "string", "name": "string", "dsn": "https://{key}@{host}/{id}" }
```
`dsn` is the full DSN string, `{host}` derived from the request's own URL (research.md §3) — correct
in local/preview/production alike.

## `GET /api/internal/projects` (existing, unchanged)

No change to this endpoint's own contract — still returns every project, `ORDER BY created_at ASC`.

## The `?project=<id>` query parameter (new, applies to every route below)

Every dashboard-facing internal route that reads project-scoped data now accepts an optional
`?project=<id>` query parameter, resolved via the new shared `resolveRequestedProject()` helper
(research.md §1, data-model.md):

- `GET /api/internal/issues`, `GET /api/internal/issues/{id}` — **behavior change**: these
  previously had no project filter at all (research.md §2); they now scope to the resolved project.
- `GET /api/internal/traces`, `GET /api/internal/traces/{id}`, `GET /api/internal/traces/by-trace-id/{traceId}`
- `GET /api/internal/logs`, `GET /api/internal/logs/live-tail`
- `GET /api/internal/checks`, `POST /api/internal/checks`, `GET /api/internal/checks/{id}`,
  `PATCH /api/internal/checks/{id}`, `DELETE /api/internal/checks/{id}`,
  `POST /api/internal/checks/{id}/trigger`, `GET /api/internal/incidents`
- `GET /api/internal/releases`, `GET /api/internal/releases/{id}`
- `GET /api/internal/feedback`, `GET /api/internal/feedback/{id}`

**Behavior common to all of the above**: `?project=` omitted or set to an id that doesn't resolve →
falls back to the first project by `created_at ASC` (data-model.md) — never a `400`/`404` purely for
an invalid/missing project selector, since a stale client-side selection must degrade gracefully
(spec Edge Cases). A route's own existing `404` behavior (e.g. "no issue with that id") is
unaffected — that's about the specific resource, not the project scope.

## Non-goals for this contract

- No endpoint to rename, delete, or rotate a project's DSN — explicitly deferred (spec Assumptions).
- No per-project membership/role restriction — every signed-in workspace member can create a
  project and select any existing one (spec Assumptions); this is not an authorization boundary.
- Ingest routes (`/api/{projectId}/envelope`, `/api/embed/error-page`) are entirely unaffected by
  `?project=` — they continue to resolve project solely from the DSN key (spec FR-008).
