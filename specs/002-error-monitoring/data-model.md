# Phase 1 Data Model: Error Monitoring

## Project (extends Module 1's entity)

| Field | Type | Notes |
|---|---|---|
| `dsn_public_key` | TEXT, NOT NULL, UNIQUE | New column. The DSN's public key component — resolved against `X-Sentry-Auth`/query-param `sentry_key` on every ingest request (research.md §1). |

**Validation rules**: generated once, server-side, at project creation/seed time — never client-
supplied. Existing demo project (Module 1) is backfilled with a real key by this module's migration
(spec.md FR-012).

## Issue

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY | |
| `project_id` | INTEGER, NOT NULL, REFERENCES projects(id) | |
| `fingerprint` | TEXT, NOT NULL | Computed per research.md §5. |
| `title` | TEXT, NOT NULL | Exception type + normalized message, or the message alone for stack-trace-less events. |
| `culprit` | TEXT | Human-readable "where" — top in-app frame's function/module, or null if unavailable. |
| `level` | TEXT, NOT NULL, DEFAULT `'error'` | As reported by the SDK (`error`, `warning`, `info`, etc.). |
| `event_count` | INTEGER, NOT NULL, DEFAULT 0 | Incremented on every new (non-duplicate) occurrence. |
| `first_seen` | TEXT, NOT NULL, DEFAULT `datetime('now')` | |
| `last_seen` | TEXT, NOT NULL, DEFAULT `datetime('now')` | Updated on every new occurrence. |

**Validation rules**: `UNIQUE(project_id, fingerprint)` — this is what makes "group by fingerprint"
an upsert rather than application-level find-then-create logic.

**State transitions**: insert (first occurrence of a fingerprint) → update `event_count`/`last_seen`
(every subsequent occurrence). No resolve/ignore/delete workflow in this module (not required by any
FR — the design mockup's bulk-resolve UI is out of scope here).

## Event

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY | Server-generated. |
| `issue_id` | TEXT, NOT NULL, REFERENCES issues(id) | |
| `project_id` | INTEGER, NOT NULL | Denormalized — the retention job (research.md §8) and rate-limit-adjacent queries scope by project without a join. |
| `sdk_event_id` | TEXT, NOT NULL | The SDK's own `event_id` from the envelope header — used for de-duplication. |
| `release` | TEXT | Nullable — not every event carries a release. |
| `environment` | TEXT | Nullable. |
| `payload` | TEXT, NOT NULL | Raw event JSON (exception/stacktrace — resolved against a source map if one applied, per research.md §5's ordering — breadcrumbs, tags, contexts), size-capped per spec FR-013. |
| `received_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | What the retention job (research.md §8) prunes against. |

**Validation rules**: `UNIQUE(project_id, sdk_event_id)` — a duplicate submission of the same
`sdk_event_id` for the same project is an upsert-no-op (satisfies spec FR-014), not a new row.

**State transitions**: insert only from ingest. Deleted by the retention job once `received_at`
exceeds the default window (90 days) — deleting an `event` row never deletes or modifies its owning
`issue` row (spec FR-015, spec's Edge Cases).

## Release

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY | |
| `project_id` | INTEGER, NOT NULL, REFERENCES projects(id) | |
| `version` | TEXT, NOT NULL | The release string as reported by SDKs/uploads — no format validation beyond non-empty. |
| `created_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | |

**Validation rules**: `UNIQUE(project_id, version)`. Created implicitly — either by the first
ingested event referencing a not-yet-seen release, or by a source map upload referencing one (spec's
Edge Cases: "source map uploaded for a release that doesn't exist yet" → implicitly recognized, not
rejected).

## Source Map

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY | |
| `project_id` | INTEGER, NOT NULL | Denormalized for lookup without a join through `releases`. |
| `release_id` | TEXT, NOT NULL, REFERENCES releases(id) | |
| `minified_path_pattern` | TEXT, NOT NULL | The minified file path (or pattern) this map resolves. |
| `r2_object_key` | TEXT, NOT NULL | Where the actual map content lives (research.md §7). |
| `uploaded_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | |

**Validation rules**: the actual file content is never written to D1 — this row is metadata only.

## Repository Connection

| Field | Type | Notes |
|---|---|---|
| `project_id` | INTEGER, PRIMARY KEY, REFERENCES projects(id) | One connection per project (spec FR-009: "exactly one"), so `project_id` is the primary key, not a separate `id`. |
| `owner` | TEXT, NOT NULL | GitHub repository owner/org. |
| `repo` | TEXT, NOT NULL | GitHub repository name. |
| `installation_id` | TEXT, NOT NULL | GitHub App installation identifier — not a secret (research.md §10), used to mint short-lived tokens on demand. |
| `connected_at` | TEXT, NOT NULL, DEFAULT `datetime('now')` | |

**Validation rules**: no access token of any kind is stored here or anywhere else in D1 — see
research.md §10 for the full token-minting flow. Connecting or disconnecting writes an `audit_log`
entry (constitution Principle X, plan.md's Constitution Check) via the same mechanism Module 1
would use for any future admin mutation — no new audit mechanism introduced.

## Not modeled in this module

- Distributed traces, structured logs, uptime checks, user feedback — later modules per the
  constitution's roadmap.
- Issue resolve/ignore/assign workflow, multi-project creation — not required by any FR in spec.md.
- Any table for storing a GitHub installation *access token* — deliberately never persisted
  (research.md §10).
