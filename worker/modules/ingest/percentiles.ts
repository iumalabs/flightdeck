// On-demand percentile computation — research.md §7 (specs/003-distributed-tracing). D1/SQLite
// has no confirmed PERCENTILE_CONT/window-function support, so p50/p95 are computed per
// (project_id, name) group via ORDER BY/OFFSET, with the offset computed inline by D1 itself via
// a scalar subquery — computeOffset() below mirrors that exact formula, kept as a pure function so
// the arithmetic is unit-testable without a database.

export function computeOffset(count: number, percentile: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.trunc(count * percentile) - 1);
}

const PERCENTILE_WINDOW = "-24 hours";

export function percentileSql(): string {
  return `SELECT duration_ms FROM transactions
    WHERE project_id = ?1 AND name = ?2 AND started_at > datetime('now', '${PERCENTILE_WINDOW}')
    ORDER BY duration_ms ASC
    LIMIT 1 OFFSET MAX(0,
      (SELECT CAST(COUNT(*) * ?3 AS INTEGER) - 1 FROM transactions
       WHERE project_id = ?1 AND name = ?2 AND started_at > datetime('now', '${PERCENTILE_WINDOW}')))`;
}

export async function fetchPercentile(
  db: D1Database,
  projectId: string,
  name: string,
  percentile: number,
): Promise<number | null> {
  const row = await db.prepare(percentileSql()).bind(projectId, name, percentile).first<
    { duration_ms: number }
  >();
  return row ? row.duration_ms : null;
}

export function operationsListSql(): string {
  return `SELECT t.name, MAX(t.op) AS op, COUNT(*) AS count,
      (SELECT id FROM transactions t2
       WHERE t2.project_id = t.project_id AND t2.name = t.name
         AND t2.started_at > datetime('now', '${PERCENTILE_WINDOW}')
       ORDER BY t2.started_at DESC LIMIT 1) AS latest_id
    FROM transactions t
    WHERE t.project_id = ?1 AND t.started_at > datetime('now', '${PERCENTILE_WINDOW}')
    GROUP BY t.name`;
}
