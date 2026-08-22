-- Module 3 (Distributed tracing): additive trace_id/span_id columns on the existing `events`
-- table (data-model.md), and a new `transactions` table storing each ingested transaction's
-- summary fields plus its full span tree inline as JSON (research.md §6 — small enough per-row
-- that R2 isn't justified the way source maps were).

ALTER TABLE events ADD COLUMN trace_id TEXT;
ALTER TABLE events ADD COLUMN span_id TEXT;
CREATE INDEX idx_events_trace_id ON events (trace_id);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  trace_id TEXT NOT NULL,
  sdk_event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  op TEXT,
  duration_ms INTEGER NOT NULL,
  -- Raw epoch seconds as the SDK sent it (research.md §6) — needed to position spans on the
  -- transaction's own time axis at read time; `started_at` below is the separate,
  -- datetime('now')-comparable text form used for retention/percentile window filtering, the
  -- same split every other module's *_at column already follows.
  start_timestamp REAL NOT NULL,
  started_at TEXT NOT NULL,
  spans_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, sdk_event_id)
);
CREATE INDEX idx_transactions_project_name_started ON transactions (project_id, name, started_at);
CREATE INDEX idx_transactions_trace_id ON transactions (trace_id);
-- Scanned by the retention job (research.md §8) to find rows past the 30-day window.
CREATE INDEX idx_transactions_received_at ON transactions (received_at);
