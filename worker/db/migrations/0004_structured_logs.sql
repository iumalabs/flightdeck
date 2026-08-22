-- Module 4 (Structured logs): batch-granularity D1 index over NDJSON log data stored in R2
-- (research.md §4-6) — never one row per log line, since log volume is the highest-volume ingest
-- surface in the project (research.md §4's ~17M-lines/day illustrative estimate).

CREATE TABLE log_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  r2_object_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  levels_present TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_log_batches_project_started ON log_batches (project_id, started_at);
-- Scanned by the retention job (research.md §9) to find rows past the 7-day window.
CREATE INDEX idx_log_batches_received_at ON log_batches (received_at);

-- FTS5 virtual table (research.md §5) — a search narrows to candidate BATCHES via MATCH/BM25; the
-- actual matching lines are extracted at read time from the batch's R2 NDJSON object, never
-- pre-extracted into D1. Carries `batch_id` as an UNINDEXED column rather than relying on FTS5's
-- own implicit integer rowid aligning with log_batches' TEXT (UUID) primary key — a correction
-- made during implementation: data-model.md's original "rowid-linked" framing assumed an integer
-- key both tables could share, which log_batches' UUID scheme (consistent with every other table
-- in this project) doesn't have.
CREATE VIRTUAL TABLE log_batches_fts USING fts5(search_text, batch_id UNINDEXED);

CREATE TABLE log_batch_traces (
  batch_id TEXT NOT NULL REFERENCES log_batches(id),
  trace_id TEXT NOT NULL,
  UNIQUE (batch_id, trace_id)
);
CREATE INDEX idx_log_batch_traces_trace_id ON log_batch_traces (trace_id);

-- Tracks that an export token was issued and its (non-secret) Cloudflare token id, so revocation
-- doesn't depend on the client having remembered the id from the create response — the SECRET
-- itself is never stored here (data-model.md's Export Credential section).
CREATE TABLE log_export_tokens (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  token_id TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
