-- Module 6 (Uptime Monitoring): HTTP/TCP checks, run on schedule and on demand through one shared
-- evaluation function (constitution Principle V), incident-aware alerting.

CREATE TABLE checks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'http' or 'tcp'
  target TEXT NOT NULL, -- a URL for 'http', 'host:port' for 'tcp'
  interval_seconds INTEGER NOT NULL, -- >= 60 (research.md §4), enforced at the application layer
  failure_threshold INTEGER NOT NULL DEFAULT 3,
  recovery_threshold INTEGER NOT NULL DEFAULT 2,
  webhook_url TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown', -- 'up', 'down', or 'unknown' (no runs yet)
  next_run_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_checks_project ON checks (project_id);
CREATE INDEX idx_checks_next_run_at ON checks (next_run_at);

CREATE TABLE check_runs (
  id TEXT PRIMARY KEY,
  check_id TEXT NOT NULL REFERENCES checks(id),
  trigger TEXT NOT NULL, -- 'scheduled' or 'interactive' — attribution only (research.md §8)
  succeeded INTEGER NOT NULL, -- boolean
  latency_ms INTEGER,
  detail TEXT,
  run_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_check_runs_check_run_at ON check_runs (check_id, run_at);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  check_id TEXT NOT NULL REFERENCES checks(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX idx_incidents_check ON incidents (check_id);
CREATE INDEX idx_incidents_open ON incidents (check_id, resolved_at);
