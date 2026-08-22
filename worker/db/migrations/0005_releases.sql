-- Module 5 (Releases): sentry-cli-compatible release management, release health, regression
-- detection, and project-scoped API tokens.

ALTER TABLE releases ADD COLUMN date_released TEXT;
ALTER TABLE releases ADD COLUMN ref TEXT;
ALTER TABLE releases ADD COLUMN url TEXT;

ALTER TABLE issues ADD COLUMN status TEXT NOT NULL DEFAULT 'unresolved';
ALTER TABLE issues ADD COLUMN resolved_release_id TEXT REFERENCES releases(id);
ALTER TABLE issues ADD COLUMN resolved_mode TEXT;

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  token_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(sub),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX idx_api_tokens_project ON api_tokens (project_id);

CREATE TABLE release_commits (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id),
  sha TEXT NOT NULL,
  message TEXT,
  author TEXT
);
CREATE INDEX idx_release_commits_release ON release_commits (release_id);

CREATE TABLE deploys (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id),
  environment TEXT NOT NULL,
  deployed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deploys_release ON deploys (release_id);

CREATE TABLE release_health (
  project_id TEXT NOT NULL REFERENCES projects(id),
  release_id TEXT NOT NULL REFERENCES releases(id),
  environment TEXT NOT NULL,
  date TEXT NOT NULL,
  sessions_total INTEGER NOT NULL DEFAULT 0,
  sessions_crashed INTEGER NOT NULL DEFAULT 0,
  sessions_errored INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, release_id, environment, date)
);
CREATE INDEX idx_release_health_project_release ON release_health (project_id, release_id);

-- Bounded distinct-user tracking (research.md §6) — capped at 10,000 rows per
-- (project_id, release_id, environment, date) bucket, enforced at the application layer, not here.
CREATE TABLE release_health_users (
  project_id TEXT NOT NULL,
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
