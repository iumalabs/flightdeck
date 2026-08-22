// Shared "fetch R2 object, parse NDJSON, filter lines" logic — research.md §5
// (specs/004-structured-logs). Used by both search (worker/modules/logs/routes.ts) and the
// trace-linkage lookup (worker/modules/traces/routes.ts's `logs` field).

export interface LogRecord {
  timestamp: string;
  level: string;
  body: string;
  attributes: Record<string, unknown>;
  traceId: string | null;
}

export interface LogFilters {
  q?: string; // free-text — matched against body + string attribute values, case-insensitive
  level?: string;
  from?: string; // ISO timestamp, inclusive
  to?: string; // ISO timestamp, inclusive
  traceId?: string;
}

// FTS5's batch-level MATCH (research.md §5) narrows candidate batches; this line-level check is
// what actually guarantees a search "finds lines containing it and excludes those that don't"
// (spec SC-002) — a batch matching at the concatenated-search_text level doesn't mean every
// individual line within it matches.
function matchesQuery(record: LogRecord, q: string): boolean {
  const needle = q.toLowerCase();
  if (record.body.toLowerCase().includes(needle)) return true;
  return Object.values(record.attributes).some(
    (value) => typeof value === "string" && value.toLowerCase().includes(needle),
  );
}

// Written by log-consumer.ts in this exact normalized shape (already flattened from the raw
// per-record OTel-style typed attributes map, spec.md Assumptions) — extraction never needs to
// re-interpret the ingest wire format.
export function parseNdjson(text: string): LogRecord[] {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const records: LogRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as LogRecord);
    } catch {
      // A malformed line never fails the rest of the batch (spec.md Edge Cases' general "one bad
      // item doesn't break the pipeline" posture, applied here at read time).
    }
  }
  return records;
}

export function filterRecords(records: LogRecord[], filters: LogFilters): LogRecord[] {
  return records.filter((record) => {
    if (filters.level && record.level !== filters.level) return false;
    if (filters.from && record.timestamp < filters.from) return false;
    if (filters.to && record.timestamp > filters.to) return false;
    if (filters.traceId && record.traceId !== filters.traceId) return false;
    if (filters.q && !matchesQuery(record, filters.q)) return false;
    return true;
  });
}

export async function extractMatchingLines(
  bucket: R2Bucket,
  r2ObjectKey: string,
  filters: LogFilters,
): Promise<LogRecord[]> {
  const object = await bucket.get(r2ObjectKey);
  if (!object) return []; // pruned/missing object — an empty result, not an error (spec.md Edge Cases)
  const text = await object.text();
  return filterRecords(parseNdjson(text), filters);
}
