# Phase 1 Data Model: Releases

## Release (extends Module 2's entity)

| Field | Type | Notes |
|---|---|---|
| `date_released` | TEXT, NULLABLE | New column. Set by `releases finalize`. Null until finalized. |
| `ref` | TEXT, NULLABLE | New column. Optional VCS ref from `releases new`. |
| `url` | TEXT, NULLABLE | New column. Optional build/CI URL from `releases new`. |

**Validation rules**: unchanged `UNIQUE(project_id, version)` from Module 2 — a duplicate
`releases new` for the same version is a no-op against the existing row (spec FR-004), not a new
row or an error.

## Release Commit

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY | |
| `release_id` | TEXT, NOT NULL, REFERENCES releases(id) | |
| `sha` | TEXT, NOT NULL | |
| `message` | TEXT | |
| `author` | TEXT | |

**Validation rules**: written by `set-commits`, sourced from the project's connected GitHub
repository (Module 2's existing `repository_connections`/GitHub App infrastructure) — one row per
commit in the specified range.

## Deploy

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY | |
| `release_id` | TEXT, NOT NULL, REFERENCES releases(id) | |
| `environment` | TEXT, NOT NULL | |
| `deployed_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | |

## Release Health

| Field | Type | Notes |
|---|---|---|
| `project_id` | TEXT, NOT NULL, REFERENCES projects(id) | |
| `release_id` | TEXT, NOT NULL, REFERENCES releases(id) | |
| `environment` | TEXT, NOT NULL | |
| `date` | TEXT, NOT NULL | The UTC day this aggregate row covers. |
| `sessions_total` | INTEGER, NOT NULL, DEFAULT 0 | |
| `sessions_crashed` | INTEGER, NOT NULL, DEFAULT 0 | |
| `sessions_errored` | INTEGER, NOT NULL, DEFAULT 0 | Sessions with `errors > 0` but not `status: crashed`. |

**Validation rules**: `UNIQUE(project_id, release_id, environment, date)` — one row per
day/release/environment, incremented via UPSERT on every ingest, never one row per session
(research.md §5).

**Indexes**: `(project_id, release_id)` — powers the release detail view's per-environment
breakdown and the release list's aggregate figures.

## Release Health User (distinct-user tracking, bounded)

| Field | Type | Notes |
|---|---|---|
| `project_id` | TEXT, NOT NULL | |
| `release_id` | TEXT, NOT NULL | |
| `environment` | TEXT, NOT NULL | |
| `date` | TEXT, NOT NULL | |
| `did` | TEXT, NOT NULL | The session's distinct/user id, as reported by the SDK. |
| `crashed` | INTEGER (boolean), NOT NULL, DEFAULT 0 | Whether this user's session(s) that day included a crash. |

**Validation rules**: `UNIQUE(project_id, release_id, environment, date, did)` — one row per
distinct user per day/release/environment, capped at 10,000 rows per
`(project_id, release_id, environment, date)` bucket (research.md §6) — inserts beyond the cap are
skipped; `users_total`/`users_crashed` are derived by `COUNT(*)`/`COUNT(*) WHERE crashed` scoped to
the bucket, understood as exact below the cap and reported as "10,000+" beyond it.

## API Token

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY | |
| `project_id` | TEXT, NOT NULL, REFERENCES projects(id) | Project-scoped (research.md §4), matching sentry-cli's own `SENTRY_PROJECT` usage. |
| `token_hash` | TEXT, NOT NULL | Salted hash — the raw token value is never stored. |
| `created_by` | TEXT, NOT NULL, REFERENCES users(sub) | |
| `created_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | |
| `revoked_at` | TEXT, NULLABLE | Null while active. |

**Validation rules**: `apiTokenAuth` fails closed (403) on a missing token, a hash that matches no
row, or a row whose `revoked_at` is non-null (constitution Principle III's posture, applied here).
The raw token value is shown to the generating user exactly once, at creation time, and is never
retrievable again — matching Module 4's planned R2 export-credential UX for the same reason
(standard API-credential handling).

## Issue (extends Module 2's entity)

| Field | Type | Notes |
|---|---|---|
| `status` | TEXT, NOT NULL, DEFAULT `'unresolved'` | New column. `unresolved` or `resolved`. |
| `resolved_release_id` | TEXT, NULLABLE, REFERENCES releases(id) | New column. The release the resolution was made against — the specific release for exact-mode resolution, or the release that existed at resolution time for "next release" mode (see below). |
| `resolved_mode` | TEXT, NULLABLE | New column. `'exact'` or `'next-release'`, null when `status = 'unresolved'`. |

**Validation rules**: `resolved_release_id`/`resolved_mode` are set together by the resolve endpoint.
They are deliberately NOT cleared when regression detection flips `status` back to `unresolved` —
they remain as a record of the last resolution this issue had, which is exactly what the UI's
"regressed in release X" indicator reads (research.md §9). They ARE overwritten (not cleared) by a
subsequent fresh `POST /:id/resolve` call, the normal case of re-resolving an issue after fixing the
regression.

**State transitions**:
- `unresolved` → `resolved` (via `POST /:id/resolve`, either mode) — sets `resolved_release_id`
  (the current release for exact mode; the resolution-time "latest known release" for next-release
  mode, per research.md §7's per-mode comparison basis) and `resolved_mode`.
- `resolved` → `unresolved` (regression detection, `worker/modules/ingest/routes.ts`'s existing
  event-ingest path) — fires when a new occurrence's release is later than `resolved_release_id`
  per the mode-specific comparison (research.md §7); `status` changes, `resolved_release_id`/
  `resolved_mode` are left as-is (see above).
- A "regressed" indicator in the UI (spec.md's acceptance scenarios) is inferred from the CURRENT
  state — `status = 'unresolved'` AND `resolved_release_id IS NOT NULL` together mean "this issue
  was resolved and has since regressed"; no separate history table is needed (research.md §9).
