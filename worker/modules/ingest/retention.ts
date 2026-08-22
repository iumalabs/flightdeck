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
