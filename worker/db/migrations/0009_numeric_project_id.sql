-- Sentry-SDK-compatibility fix: the real @sentry/core SDK (used by @sentry/node, @sentry/react,
-- @sentry/browser, etc.) validates a DSN's project-id path segment against /^\d+$/ in dsn.ts and
-- silently disables the transport (no error, but nothing is ever sent) when it doesn't match.
-- FlightDeck issued DSNs shaped `https://{dsn_public_key}@{host}/{uuid}` — `projects.id` was a
-- TEXT UUID (or the literal seed string "demo") — which never matched, making FlightDeck not
-- actually drop-in-compatible with any unmodified Sentry SDK, contradicting constitution
-- Principle IV. This migration switches `projects.id` to D1/SQLite's native INTEGER PRIMARY KEY
-- (an alias for the table's own rowid, auto-assigning 1, 2, 3, ... with no AUTOINCREMENT needed)
-- and every `project_id` foreign-key column that references it to INTEGER, project-wide — not
-- just at the DSN surface — per the project owner's explicit decision to fully consolidate on one
-- id scheme rather than carry a dual UUID-internal/integer-external id indefinitely. Real Sentry's
-- own protocol treats the numeric project id as non-secret (access control is via the DSN's
-- public key, not id secrecy), so there is no security reason to keep an opaque internal id.
--
-- D1/SQLite has no ALTER COLUMN ... TYPE, so every affected table is dropped and recreated with
-- the new column type via the standard SQLite table-recreation pattern. There is currently NO real
-- production data in this project — only demo/QA fixture data — so, per the owner's explicit
-- instruction, this migration WIPES all of it rather than attempting a UUID -> integer
-- backfill/remap. Tables that merely reference a row whose OWN table is being wiped here
-- (check_runs/incidents -> checks, release_commits/deploys -> releases, log_batch_traces/
-- log_batches_fts -> log_batches) don't have a project_id column themselves and so don't need a
-- schema change, but their rows are cleared too since they'd otherwise be orphaned by the parent
-- wipe. `users` and `audit_log` have no project relationship at all and are left untouched.
--
-- Tables with a project_id column (and therefore a schema change): issues, events, releases,
-- source_maps, repository_connections, transactions, log_batches, log_export_tokens, api_tokens,
-- release_health, release_health_users, checks, feedback.

-- ---------------------------------------------------------------------------
-- Phase 1: clear data from tables that don't get a schema change but would otherwise be left
-- holding rows that reference now-wiped parents (checks, releases, log_batches).
-- ---------------------------------------------------------------------------
DELETE FROM check_runs;
DELETE FROM incidents;
DELETE FROM release_commits;
DELETE FROM deploys;
DELETE FROM log_batch_traces;
DELETE FROM log_batches_fts;

-- ---------------------------------------------------------------------------
-- Phase 2: drop every table with a project_id column (children before parents), then `projects`
-- itself last.
-- ---------------------------------------------------------------------------
DROP TABLE feedback;
DROP TABLE events;
DROP TABLE issues;
DROP TABLE transactions;
DROP TABLE source_maps;
DROP TABLE checks;
DROP TABLE log_batches;
DROP TABLE log_export_tokens;
DROP TABLE api_tokens;
DROP TABLE release_health;
DROP TABLE release_health_users;
DROP TABLE releases;
DROP TABLE repository_connections;
DROP TABLE projects;

-- ---------------------------------------------------------------------------
-- Phase 3: recreate `projects` first, with the new INTEGER PRIMARY KEY, then re-seed one demo
-- project (id auto-assigns to 1 on this fresh table) — a fresh `INSERT ... (name, dsn_public_key)`
-- rather than hardcoding the old literal "demo" id anywhere.
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dsn_public_key TEXT
);
CREATE UNIQUE INDEX idx_projects_dsn_public_key ON projects (dsn_public_key);

INSERT INTO projects (name, dsn_public_key) VALUES ('Demo Project', lower(hex(randomblob(16))));

-- ---------------------------------------------------------------------------
-- Phase 4: recreate every dependent table, full original DDL (columns/constraints/indexes)
-- identical except project_id TEXT -> project_id INTEGER. Every other id column (all still
-- UUID-based, unrelated to this migration) is untouched.
-- ---------------------------------------------------------------------------

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  culprit TEXT,
  level TEXT NOT NULL DEFAULT 'error',
  event_count INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'unresolved',
  resolved_release_id TEXT REFERENCES releases(id),
  resolved_mode TEXT,
  UNIQUE (project_id, fingerprint)
);
CREATE INDEX idx_issues_project_last_seen ON issues (project_id, last_seen DESC);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  project_id INTEGER NOT NULL,
  sdk_event_id TEXT NOT NULL,
  release TEXT,
  environment TEXT,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  trace_id TEXT,
  span_id TEXT,
  UNIQUE (project_id, sdk_event_id)
);
CREATE INDEX idx_events_issue_received ON events (issue_id, received_at DESC);
CREATE INDEX idx_events_received_at ON events (received_at);
CREATE INDEX idx_events_trace_id ON events (trace_id);

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  date_released TEXT,
  ref TEXT,
  url TEXT,
  UNIQUE (project_id, version)
);

CREATE TABLE source_maps (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  release_id TEXT NOT NULL REFERENCES releases(id),
  minified_path_pattern TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_source_maps_release ON source_maps (release_id);

CREATE TABLE repository_connections (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id),
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  trace_id TEXT NOT NULL,
  sdk_event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  op TEXT,
  duration_ms INTEGER NOT NULL,
  start_timestamp REAL NOT NULL,
  started_at TEXT NOT NULL,
  spans_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, sdk_event_id)
);
CREATE INDEX idx_transactions_project_name_started ON transactions (project_id, name, started_at);
CREATE INDEX idx_transactions_trace_id ON transactions (trace_id);
CREATE INDEX idx_transactions_received_at ON transactions (received_at);

CREATE TABLE log_batches (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  r2_object_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  levels_present TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  envelope_event_id TEXT
);
CREATE INDEX idx_log_batches_project_started ON log_batches (project_id, started_at);
CREATE INDEX idx_log_batches_received_at ON log_batches (received_at);
CREATE UNIQUE INDEX idx_log_batches_envelope_event_id ON log_batches (project_id, envelope_event_id);

CREATE TABLE log_export_tokens (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id),
  token_id TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  token_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(sub),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX idx_api_tokens_project ON api_tokens (project_id);

CREATE TABLE release_health (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  release_id TEXT NOT NULL REFERENCES releases(id),
  environment TEXT NOT NULL,
  date TEXT NOT NULL,
  sessions_total INTEGER NOT NULL DEFAULT 0,
  sessions_crashed INTEGER NOT NULL DEFAULT 0,
  sessions_errored INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, release_id, environment, date)
);
CREATE INDEX idx_release_health_project_release ON release_health (project_id, release_id);

CREATE TABLE release_health_users (
  project_id INTEGER NOT NULL,
  release_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  date TEXT NOT NULL,
  did TEXT NOT NULL,
  crashed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, release_id, environment, date, did)
);
CREATE INDEX idx_release_health_users_bucket ON release_health_users (
  project_id, release_id, environment, date
);

CREATE TABLE checks (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  target TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  failure_threshold INTEGER NOT NULL DEFAULT 3,
  recovery_threshold INTEGER NOT NULL DEFAULT 2,
  webhook_url TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown',
  next_run_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_checks_project ON checks (project_id);
CREATE INDEX idx_checks_next_run_at ON checks (next_run_at);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  message TEXT NOT NULL,
  name TEXT,
  contact_email TEXT,
  url TEXT,
  associated_event_id TEXT,
  issue_id TEXT REFERENCES issues(id),
  sdk_event_id TEXT,
  source TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_feedback_project_received ON feedback (project_id, received_at);
CREATE INDEX idx_feedback_issue ON feedback (issue_id);
CREATE UNIQUE INDEX idx_feedback_dialog_dedup ON feedback (project_id, associated_event_id)
  WHERE source = 'crash_report_dialog';
