-- Module 7 (User Feedback): a widget-based envelope path and a crash-report-dialog path, both
-- converging on this one table.

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  message TEXT NOT NULL,
  name TEXT,
  contact_email TEXT,
  url TEXT,
  associated_event_id TEXT,
  issue_id TEXT REFERENCES issues(id),
  sdk_event_id TEXT,
  source TEXT NOT NULL, -- 'widget' or 'crash_report_dialog'
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_feedback_project_received ON feedback (project_id, received_at);
CREATE INDEX idx_feedback_issue ON feedback (issue_id);

-- research.md §1's confirmed upsert behavior — a retried crash-report-dialog submission for the
-- same event overwrites in place rather than duplicating. Scoped to the dialog path only (partial
-- index on source = 'crash_report_dialog') since the widget path's own dedup key is
-- (project_id, sdk_event_id) instead — a widget submission isn't inherently tied to one
-- associated_event_id (standalone feedback has none).
CREATE UNIQUE INDEX idx_feedback_dialog_dedup ON feedback (project_id, associated_event_id)
  WHERE source = 'crash_report_dialog';
