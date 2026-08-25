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

// The real @sentry/core SDK's own dsn.ts validates a DSN's project-id path segment against
// /^\d+$/ and silently disables the transport (no error, but nothing is ever sent) when it
// doesn't match — migration 0009 made `projects.id` a genuinely numeric INTEGER PRIMARY KEY so
// FlightDeck-issued DSNs satisfy that regex. `:projectId` still arrives here as a plain URL path
// string regardless (Hono route params are always strings) — this rejects anything that isn't a
// clean positive integer BEFORE it ever reaches a query bind, rather than relying on SQLite's
// implicit TEXT->INTEGER affinity coercion to just happen to do the right thing. No leading zeros,
// no sign, no "0" itself (SQLite's rowid-alias PRIMARY KEY never assigns 0), matching every id this
// migration actually issues.
export function isNumericProjectId(projectId: string): boolean {
  return /^[1-9][0-9]*$/.test(projectId);
}

// "internal" is reserved (research.md §3) — never resolves as a project, checked here too as a
// second line of defense alongside the route-level guard in routes.ts.
export async function resolveProjectByDsnKey(
  db: D1Database,
  projectId: string,
  sentryKey: string,
): Promise<ResolvedProject | null> {
  if (projectId === "internal" || !sentryKey || !isNumericProjectId(projectId)) {
    return null;
  }
  const row = await db
    // CAST back to TEXT (migration 0009 made `id` INTEGER) — see resolve.ts's identical comment;
    // every downstream use of `project.id` here (Durable Object idFromName, which throws on a
    // non-string, Queue message bodies, audit-adjacent JSON) expects the opaque string this always
    // returned.
    .prepare(`SELECT CAST(id AS TEXT) AS id FROM projects WHERE id = ?1 AND dsn_public_key = ?2`)
    .bind(projectId, sentryKey)
    .first<ResolvedProject>();
  return row ?? null;
}
