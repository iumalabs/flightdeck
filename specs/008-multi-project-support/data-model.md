# Phase 1 Data Model: Multi-Project Support

No new table, no new column, no migration — `projects` and `dsn_public_key` already exist
(`0002_error_monitoring.sql`). This feature only adds a write path (create) and a read-scoping
mechanism (resolve) over the existing entity.

## Project (existing, unchanged shape)

| Field | Type | Notes |
|---|---|---|
| `id` | INTEGER, PRIMARY KEY | Migration 0009 (Sentry-SDK-compatibility fix): D1/SQLite's native auto-assigning rowid alias, not `crypto.randomUUID()` — the real `@sentry/core` SDK validates a DSN's project-id path segment against `/^\d+$/` and silently drops events otherwise. Every application-layer consumer still treats it as an opaque string (`CAST(id AS TEXT)` at every read site). |
| `name` | TEXT, NOT NULL | Unchanged. Not unique — data-model.md's Edge Case: two projects MAY share a display name (spec Edge Cases). |
| `dsn_public_key` | TEXT | Unchanged column, `UNIQUE` index already exists (migration 0002). Generated via `lower(hex(randomblob(16)))` for a new project (research.md §3), same expression used to backfill "demo". |
| `created_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | Unchanged. This is the ordering column both `GET /api/internal/projects` and the new default-project fallback (research.md §1) already rely on — no new "first project" concept, reusing the existing one. |

**Validation rules**: `name` MUST be a non-empty string (spec FR-002) — enforced at the application
layer (a `400` on empty/missing, not a DB constraint), matching this codebase's established pattern
for required-field validation (e.g. Module 6's check-name, Module 7's feedback-message).

**State transitions**: none new — a `Project` row is still write-once at creation (name/DSN are
never mutated after creation in this feature's scope; renaming/DSN-rotation are explicitly deferred,
spec Assumptions).

## Cross-cutting: request-level project resolution (not a stored entity)

`resolveRequestedProject(db, requestedId)` (`worker/modules/projects/resolve.ts`) is a pure
read-time resolution, not new persisted state:

- `requestedId` present and resolves to a real project → that project.
- `requestedId` present but does not resolve (deleted/invalid — spec Edge Cases) → falls back to the
  first project by `created_at ASC`, exactly as if `requestedId` had been omitted. Never a `404` for
  this specific case — a stale/invalid selection degrading gracefully to "the default project" is
  what spec Edge Cases requires ("must not crash if it ever points at a project the workspace no
  longer has access to").
- `requestedId` omitted → first project by `created_at ASC`.
- No projects exist at all (a broken/unseeded workspace, not reachable in normal operation since
  Module 1's baseline migration always seeds "demo") → returns `null`; callers treat this the same
  way they already treat "issue not found" etc. — a `404`/empty-list response, not a throw.
