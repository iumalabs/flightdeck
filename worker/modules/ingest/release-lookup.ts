// Shared release resolution — used by both session-ingest (release-health writes) and regression
// detection (the "event" path), since both need a release's id/creation-order position, not just
// its version string.

export interface ReleaseRow {
  id: string;
  created_at: string;
}

// Implicitly creates the release if it doesn't exist yet — matching Module 2's existing
// source-map-upload behavior for the same "release referenced before it's explicitly created" case
// (spec.md's Edge Cases).
export async function resolveOrCreateRelease(
  db: D1Database,
  projectId: string,
  version: string,
): Promise<ReleaseRow> {
  const existing = await db
    .prepare(`SELECT id, created_at FROM releases WHERE project_id = ?1 AND version = ?2`)
    .bind(projectId, version)
    .first<ReleaseRow>();
  if (existing) return existing;

  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO releases (id, project_id, version) VALUES (?1, ?2, ?3)`)
    .bind(id, projectId, version)
    .run();
  const created = await db
    .prepare(`SELECT id, created_at FROM releases WHERE id = ?1`)
    .bind(id)
    .first<ReleaseRow>();
  return created!;
}

// The release created immediately AFTER a given one, by creation order — the comparison basis for
// "resolved in next release" mode (research.md §7). Null if none exists yet.
export async function findNextReleaseAfter(
  db: D1Database,
  projectId: string,
  releaseCreatedAt: string,
): Promise<ReleaseRow | null> {
  const row = await db
    .prepare(
      `SELECT id, created_at FROM releases
       WHERE project_id = ?1 AND created_at > ?2
       ORDER BY created_at ASC LIMIT 1`,
    )
    .bind(projectId, releaseCreatedAt)
    .first<ReleaseRow>();
  return row ?? null;
}
