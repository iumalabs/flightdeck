// DSN key extraction and resolution — contracts/ingest-api.md, research.md §1
// (specs/002-error-monitoring). Confirmed via Sentry's own developer docs: @sentry/browser
// authenticates via the query string, sentry-sdk (Python) via the X-Sentry-Auth header — both are
// checked; if both are present they must agree.

export function extractSentryKey(request: Request): string | null {
  const url = new URL(request.url);
  const queryKey = url.searchParams.get("sentry_key");

  const authHeader = request.headers.get("X-Sentry-Auth");
  let headerKey: string | null = null;
  if (authHeader) {
    const match = authHeader.match(/sentry_key=([^,\s]+)/);
    headerKey = match ? match[1] : null;
  }

  if (headerKey && queryKey) {
    return headerKey === queryKey ? headerKey : null;
  }
  return headerKey ?? queryKey ?? null;
}

export interface ResolvedProject {
  id: string;
}

// "internal" is reserved (research.md §3) — never resolves as a project, checked here too as a
// second line of defense alongside the route-level guard in routes.ts.
export async function resolveProjectByDsnKey(
  db: D1Database,
  projectId: string,
  sentryKey: string,
): Promise<ResolvedProject | null> {
  if (projectId === "internal" || !sentryKey) {
    return null;
  }
  const row = await db
    .prepare(`SELECT id FROM projects WHERE id = ?1 AND dsn_public_key = ?2`)
    .bind(projectId, sentryKey)
    .first<ResolvedProject>();
  return row ?? null;
}
