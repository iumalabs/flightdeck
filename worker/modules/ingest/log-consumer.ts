// Queue consumer for log ingest — research.md §4-6 (specs/004-structured-logs). One queue message
// = one envelope submission's whole batched `items` array (up to 100 records, Sentry's own
// SDK-side cap). Each message is processed independently (own try/catch, own ack/retry), matching
// Module 3's trace-consumer.ts pattern exactly.

import type { LogRecord } from "../logs/extract.ts";

// Raw per-record wire shape (contracts/log-ingest-api.md) — `attributes` values are OpenTelemetry
// AnyValue-shaped ({value, type}), not bare scalars.
export interface RawLogRecord {
  timestamp: number;
  trace_id?: string;
  span_id?: string;
  level: string;
  body: string;
  severity_number?: number;
  attributes?: Record<string, { value: unknown; type: string }>;
}

export interface QueuedLogBatch {
  projectId: string;
  records: RawLogRecord[];
}

interface Env {
  DB: D1Database;
  LOGS: R2Bucket;
}

function toIsoTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

// Flattens the raw OTel-typed attributes map to plain values — the shape
// contracts/logs-internal-api.md's search response already expects (spec.md Assumptions: search
// covers attribute VALUES, not their OTel type wrapper).
function flattenAttributes(
  attributes: RawLogRecord["attributes"],
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, typed] of Object.entries(attributes ?? {})) {
    flat[key] = typed.value;
  }
  return flat;
}

export function normalizeRecord(raw: RawLogRecord): LogRecord {
  return {
    timestamp: toIsoTimestamp(raw.timestamp),
    level: raw.level,
    body: raw.body,
    attributes: flattenAttributes(raw.attributes),
    traceId: raw.trace_id ?? null,
  };
}

// The concatenation of every record's body plus its STRING-typed attribute values within the
// batch (research.md §5) — only string-typed values contribute free text worth indexing.
export function buildSearchText(records: RawLogRecord[]): string {
  const parts: string[] = [];
  for (const record of records) {
    parts.push(record.body);
    for (const typed of Object.values(record.attributes ?? {})) {
      if (typed.type === "string" && typeof typed.value === "string") parts.push(typed.value);
    }
  }
  return parts.join(" ");
}

export function distinctTraceIds(records: RawLogRecord[]): string[] {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.trace_id) ids.add(record.trace_id);
  }
  return [...ids];
}

function partitionPrefix(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${
    pad(now.getUTCHours())
  }`;
}

export async function handleLogIngestBatch(
  batch: MessageBatch<QueuedLogBatch>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const { projectId, records } = message.body;
      if (records.length === 0) {
        message.ack();
        continue;
      }

      const timestamps = records.map((r) => r.timestamp);
      const startedAt = toIsoTimestamp(Math.min(...timestamps));
      const endedAt = toIsoTimestamp(Math.max(...timestamps));
      const levelsPresent = [...new Set(records.map((r) => r.level))].join(",");

      const batchId = crypto.randomUUID();
      const r2ObjectKey = `${projectId}/${partitionPrefix(new Date())}/${batchId}.ndjson`;
      const ndjson = records.map((r) => JSON.stringify(normalizeRecord(r))).join("\n");
      await env.LOGS.put(r2ObjectKey, ndjson);

      const searchText = buildSearchText(records);
      const traceIds = distinctTraceIds(records);

      const statements = [
        env.DB.prepare(
          `INSERT INTO log_batches
             (id, project_id, r2_object_key, started_at, ended_at, record_count, levels_present, received_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))`,
        ).bind(batchId, projectId, r2ObjectKey, startedAt, endedAt, records.length, levelsPresent),
        env.DB.prepare(
          `INSERT INTO log_batches_fts (search_text, batch_id) VALUES (?1, ?2)`,
        ).bind(searchText, batchId),
        ...traceIds.map((traceId) =>
          env.DB.prepare(
            `INSERT INTO log_batch_traces (batch_id, trace_id) VALUES (?1, ?2)
             ON CONFLICT(batch_id, trace_id) DO NOTHING`,
          ).bind(batchId, traceId)
        ),
      ];
      // One db.batch() call for this ONE message's own several writes (batch row + fts row +
      // junction rows) — atomic together is correct here, unlike Module 3's explicit avoidance of
      // db.batch() across MULTIPLE independent queue messages (trace-consumer.ts's comment).
      await env.DB.batch(statements);

      message.ack();
    } catch (err) {
      console.error("log-consumer: failed to write log batch, will retry", err);
      message.retry();
    }
  }
}
