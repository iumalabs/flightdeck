// Shared check-creation helper (issue #72) — both POST /api/internal/v1/checks (routes.ts) and
// project-creation's default-check seeding (../projects/default-checks.ts) go through this so a
// seeded check is indistinguishable from one a user created by hand: same INSERT, same
// max-checks-per-project enforcement, same threshold defaults. Any future change to check-creation
// logic (new column, new validation) lands in both call sites for free instead of silently being
// unimplemented for the seeded path.

// research.md §4 (specs/006-uptime-monitoring) — real abuse-prevention bounds, not user-facing
// configuration.
export const MIN_INTERVAL_SECONDS = 60;
export const MAX_CHECKS_PER_PROJECT = 20;

export interface CreateCheckInput {
  name: string;
  type: "http" | "tcp";
  target: string;
  intervalSeconds: number;
  failureThreshold?: number;
  recoveryThreshold?: number;
  webhookUrl?: string | null;
}

export interface CreatedCheck {
  id: string;
  name: string;
  type: string;
  target: string;
  intervalSeconds: number;
  failureThreshold: number;
  recoveryThreshold: number;
  webhookUrl: string | null;
}

// Returns the created check, or the string "limit-reached" if the project is already at
// MAX_CHECKS_PER_PROJECT (callers decide how to surface that — a 403 for a user-initiated create,
// a silent skip for seeding).
export async function createCheck(
  db: D1Database,
  projectId: string,
  input: CreateCheckInput,
): Promise<CreatedCheck | "limit-reached"> {
  const { count } = await db
    .prepare(`SELECT COUNT(*) as count FROM checks WHERE project_id = ?1`)
    .bind(projectId)
    .first<{ count: number }>() ?? { count: 0 };
  if (count >= MAX_CHECKS_PER_PROJECT) return "limit-reached";

  const id = crypto.randomUUID();
  const failureThreshold = input.failureThreshold ?? 3;
  const recoveryThreshold = input.recoveryThreshold ?? 2;
  const webhookUrl = input.webhookUrl ?? null;

  await db
    .prepare(
      `INSERT INTO checks
         (id, project_id, name, type, target, interval_seconds, failure_threshold, recovery_threshold, webhook_url)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      id,
      projectId,
      input.name,
      input.type,
      input.target,
      input.intervalSeconds,
      failureThreshold,
      recoveryThreshold,
      webhookUrl,
    )
    .run();

  return {
    id,
    name: input.name,
    type: input.type,
    target: input.target,
    intervalSeconds: input.intervalSeconds,
    failureThreshold,
    recoveryThreshold,
    webhookUrl,
  };
}
