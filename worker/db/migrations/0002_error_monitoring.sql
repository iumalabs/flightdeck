-- Module 2 (Error monitoring): DSN issuance, issues/events/releases/source-map/repository-connection
-- tables, and the audit_log table constitution Principle X requires now that this module introduces
-- FlightDeck's first real admin mutations (GitHub connect/disconnect, source map upload) — deferred
-- from Module 1's baseline migration since it had none yet (see specs/001-landing-access-login/
-- plan.md's Constitution Check).

-- SQLite can't add a NOT NULL/UNIQUE column to a populated table in one step; add it nullable,
-- backfill, then enforce uniqueness via an index (data-model.md).
ALTER TABLE projects ADD COLUMN dsn_public_key TEXT;
UPDATE projects SET dsn_public_key = lower(hex(randomblob(16)))
  WHERE id = 'demo' AND dsn_public_key IS NULL;
CREATE UNIQUE INDEX idx_projects_dsn_public_key ON projects (dsn_public_key);

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  culprit TEXT,
  level TEXT NOT NULL DEFAULT 'error',
  event_count INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, fingerprint)
);
CREATE INDEX idx_issues_project_last_seen ON issues (project_id, last_seen DESC);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  project_id TEXT NOT NULL,
  sdk_event_id TEXT NOT NULL,
  release TEXT,
  environment TEXT,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, sdk_event_id)
);
CREATE INDEX idx_events_issue_received ON events (issue_id, received_at DESC);
-- Scanned by the retention job (research.md §8) to find rows past the default window.
CREATE INDEX idx_events_received_at ON events (received_at);

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, version)
);

CREATE TABLE source_maps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  release_id TEXT NOT NULL REFERENCES releases(id),
  minified_path_pattern TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_source_maps_release ON source_maps (release_id);

-- One connection per project (spec FR-009) — project_id is the primary key, not a separate id.
CREATE TABLE repository_connections (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Constitution Principle X: every admin mutation MUST be recorded. First module to actually need
-- this table (Module 1 had no admin mutations yet).
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_sub TEXT NOT NULL REFERENCES users(sub),
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at DESC);
