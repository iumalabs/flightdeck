-- T044 convergence gap (specs/004-structured-logs data-model.md's Log Batch validation rules):
-- submission-level de-duplication for log ingest. The envelope header's own `event_id` (Sentry
-- protocol; distinct from any per-record field, since a "log" item batches many independent
-- records with no per-record event_id of their own, research.md §1) identifies ONE envelope
-- submission. The queue consumer (log-consumer.ts) checks this before writing a new
-- `log_batches` row, so a client retry of the same submission or Cloudflare Queues'
-- at-least-once redelivery of the same message is a no-op, not a duplicate row.
--
-- Nullable: a client whose envelope header omits event_id (legal per protocol) simply isn't
-- deduplicated, same as before this column existed. SQLite treats NULL as distinct within a
-- UNIQUE index, so any number of NULL-identifier rows coexist without conflicting with each
-- other.

ALTER TABLE log_batches ADD COLUMN envelope_event_id TEXT;
CREATE UNIQUE INDEX idx_log_batches_envelope_event_id ON log_batches (project_id, envelope_event_id);
