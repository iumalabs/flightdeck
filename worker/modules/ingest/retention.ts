// constitution Principle IX / spec FR-015 (specs/002-error-monitoring): retention MUST default to
// a bounded, documented period, not "eventually". Prunes only `events` rows — an issue's own
// summary fields (title, culprit, event_count, first_seen, last_seen) are untouched, so aggregate
// history survives even after the underlying raw events age out (research.md §8).
export const RETENTION_DAYS = 90;

export async function pruneOldEvents(db: D1Database): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM events WHERE received_at < datetime('now', ?1)`)
    .bind(`-${RETENTION_DAYS} days`)
    .run();
  return result.meta.changes ?? 0;
}

// specs/003-distributed-tracing research.md §8: transactions get their own, shorter window than
// events — trace volume is structurally higher per session, and unlike the issues/events split, a
// `transactions` row IS the summary (full row deletion, no separate aggregate to preserve).
export const TRANSACTION_RETENTION_DAYS = 30;

export async function pruneOldTransactions(db: D1Database): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM transactions WHERE received_at < datetime('now', ?1)`)
    .bind(`-${TRANSACTION_RETENTION_DAYS} days`)
    .run();
  return result.meta.changes ?? 0;
}

// specs/004-structured-logs research.md §9: logs get the shortest window of any module — this
// project's highest-volume ingest surface. A log_batches row has no separate summary/aggregate
// to preserve (like Module 3's transactions), so pruning is full deletion — D1 rows AND the
// underlying R2 NDJSON object.
export const LOG_RETENTION_DAYS = 7;

interface PrunableBatch {
  id: string;
  r2_object_key: string;
}

// specs/006-uptime-monitoring research.md §5: check_runs is genuinely high-frequency, append-only
// data (up to ~28,800 rows/day/project at the 60s-floor/20-checks cap), so it gets the same bounded-
// window treatment as Modules 3-4's data, even though it isn't customer-submitted telemetry.
// `checks`/`incidents` are NOT pruned here — low-volume summary/configuration data (data-model.md).
export const CHECK_RUN_RETENTION_DAYS = 30;

export async function pruneOldCheckRuns(db: D1Database): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM check_runs WHERE run_at < datetime('now', ?1)`)
    .bind(`-${CHECK_RUN_RETENTION_DAYS} days`)
    .run();
  return result.meta.changes ?? 0;
}

export async function pruneOldLogBatches(db: D1Database, bucket: R2Bucket): Promise<number> {
  const { results } = await db
    .prepare(`SELECT id, r2_object_key FROM log_batches WHERE received_at < datetime('now', ?1)`)
    .bind(`-${LOG_RETENTION_DAYS} days`)
    .all<PrunableBatch>();
  const prunable = results ?? [];
  if (prunable.length === 0) return 0;

  await Promise.all(prunable.map((batch) => bucket.delete(batch.r2_object_key)));

  const ids = prunable.map((batch) => batch.id);
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(",");
  await db.batch([
    db.prepare(`DELETE FROM log_batches WHERE id IN (${placeholders})`).bind(...ids),
    db.prepare(`DELETE FROM log_batches_fts WHERE batch_id IN (${placeholders})`).bind(...ids),
    db.prepare(`DELETE FROM log_batch_traces WHERE batch_id IN (${placeholders})`).bind(...ids),
  ]);

  return prunable.length;
}
