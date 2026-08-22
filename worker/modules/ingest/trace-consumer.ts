// Queue consumer for trace ingest — research.md §4-6 (specs/003-distributed-tracing). Each
// message is processed independently (own try/catch, own ack/retry) so one malformed transaction
// in a batch never blocks or rolls back the other messages in it — deliberately NOT one
// `db.batch()` call for the whole batch, since D1's batch runs its statements as a single
// transaction and would roll every message back together on one failure, contradicting research.md
// §4's explicit per-message independence requirement.

export interface QueuedTransaction {
  projectId: string;
  traceId: string;
  sdkEventId: string;
  name: string;
  op: string | null;
  startTimestamp: number;
  timestamp: number;
  spans: unknown[];
}

interface Env {
  DB: D1Database;
}

// timestamp/start_timestamp are epoch seconds with fractional precision, per Sentry's protocol
// (research.md §2) — computed once here, never recomputed at read time (data-model.md).
export function computeDurationMs(startTimestamp: number, timestamp: number): number {
  return Math.max(0, Math.round((timestamp - startTimestamp) * 1000));
}

export async function handleTraceIngestBatch(
  batch: MessageBatch<QueuedTransaction>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const t = message.body;
      const durationMs = computeDurationMs(t.startTimestamp, t.timestamp);

      // ON CONFLICT DO NOTHING: a duplicate sdk_event_id — a client retry or a queue-level
      // redelivery under Cloudflare Queues' at-least-once semantics — is a no-op, mirroring
      // Module 2's event dedup (data-model.md's Validation rules).
      await env.DB
        .prepare(
          `INSERT INTO transactions
             (id, project_id, trace_id, sdk_event_id, name, op, duration_ms,
              start_timestamp, started_at, spans_json, received_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime(?8, 'unixepoch'), ?9, datetime('now'))
           ON CONFLICT(project_id, sdk_event_id) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          t.projectId,
          t.traceId,
          t.sdkEventId,
          t.name,
          t.op,
          durationMs,
          t.startTimestamp,
          JSON.stringify(t.spans ?? []),
        )
        .run();

      message.ack();
    } catch (err) {
      console.error("trace-consumer: failed to write transaction, will retry", err);
      message.retry();
    }
  }
}
