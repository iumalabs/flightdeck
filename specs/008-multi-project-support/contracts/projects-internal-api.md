# Internal API Contract: Multi-Project Support

Control-plane (constitution Principle I), `sessionAuth`-gated, unchanged from every prior module.

## `POST /api/internal/projects` (new)

**Request**: `{ "name": "string", "baseUrl"?: "string" }`. `baseUrl` was added by issue #72.

**Behavior**: rejects an empty/missing `name` with `400`. Generates `dsn_public_key` via
`lower(hex(randomblob(16)))` (research.md §3), writes `audit_log` (`action: "project.create"`) in
the same transaction as the insert.

**`baseUrl` (issue #72, optional)**: when omitted or blank, behavior is unchanged from before this
field existed — no default checks seeded. When present, it must be a well-formed absolute `http(s)`
URL or the request is rejected with `400` (same as an invalid `name`) — the project row is not
created in that case. When valid, two default uptime checks are seeded against it after the project
is created (via the same `createCheck()` helper `POST /api/internal/checks` uses, so a seeded check
is indistinguishable from a hand-made one — same threshold/interval defaults, same
max-checks-per-project enforcement):

- An HTTP check named "Root" against `baseUrl` exactly as given — always seeded, regardless of
  whether it's reachable at creation time (that's the point of an uptime check).
- An HTTP check named "Health" against the first of `{baseUrl}/health`, `{baseUrl}/api/health` that
  answers a live, synchronous probe with a real `200` at creation time — skipped entirely if neither
  candidate does, since a check with no real target would just be noise to delete (issue #72). The
  probe uses a short (3s per candidate) timeout so it can never make project creation hang; a
  slow/erroring candidate is treated the same as a non-200 one.

Seeding is best-effort: any failure while seeding (DB error, probe error, etc.) is logged and
swallowed, never rolled back and never surfaced as a failed project-creation response — the project
itself is always created successfully once its own insert succeeds, independent of `baseUrl`. Each
successfully-seeded check gets its own `audit_log` row (`action: "check.create"`, same shape a
user-initiated check-create uses, plus a `seeded: true` marker).

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
- `GET /api/internal/traces`, `GET /api/internal/traces/{id}`,
  `GET /api/internal/traces/by-trace-id/{traceId}`
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
- No per-project membership/role restriction — every signed-in workspace member can create a project
  and select any existing one (spec Assumptions); this is not an authorization boundary.
- Ingest routes (`/api/{projectId}/envelope`, `/api/embed/error-page`) are entirely unaffected by
  `?project=` — they continue to resolve project solely from the DSN key (spec FR-008).
