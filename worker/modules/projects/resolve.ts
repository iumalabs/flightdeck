// Shared request-level project resolution (specs/008-multi-project-support) — every pillar
// module's dashboard-facing routes.ts imports this instead of hardcoding a project id or
// reimplementing the fallback logic (constitution Principle V).

export interface ResolvedProject {
  id: string;
  name: string;
}

// `requestedId` present and resolves -> that project. Present but doesn't resolve (deleted/invalid
// selection, data-model.md's Edge Case) -> falls back to the first project, exactly as if omitted.
// No projects exist at all -> null (data-model.md's Cross-cutting section) — callers treat this the
// same way they already treat "not found", not a throw.
export async function resolveRequestedProject(
  db: D1Database,
  requestedId: string | null,
): Promise<ResolvedProject | null> {
  if (requestedId) {
    const requested = await db
      .prepare(`SELECT id, name FROM projects WHERE id = ?1`)
      .bind(requestedId)
      .first<ResolvedProject>();
    if (requested) return requested;
  }

  const fallback = await db
    .prepare(`SELECT id, name FROM projects ORDER BY created_at ASC LIMIT 1`)
    .first<ResolvedProject>();
  return fallback ?? null;
}
