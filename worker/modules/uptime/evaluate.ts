import { runHttpCheck } from "./http-check.ts";
import { runTcpCheck } from "./tcp-check.ts";
import { deliverWebhook } from "./webhook.ts";

interface Env {
  DB: D1Database;
}

export type CheckTrigger = "scheduled" | "interactive";

export interface RunCheckResult {
  succeeded: boolean;
  latencyMs: number | null;
  detail: string | null;
  status: "up" | "down";
  incidentOpened: boolean;
  incidentResolved: boolean;
}

interface CheckRow {
  id: string;
  name: string;
  type: string;
  target: string;
  failure_threshold: number;
  recovery_threshold: number;
  webhook_url: string | null;
}

interface UpdatedCounters {
  consecutive_failures: number;
  consecutive_successes: number;
}

// constitution Principle V's single shared evaluation function (research.md §8) — both
// `worker/index.ts`'s scheduled() uptime case and `POST /api/internal/checks/:id/trigger`
// (worker/modules/uptime/routes.ts) call this exact export, differing only in the `trigger` value
// they pass, which is recorded on the resulting check_runs row for attribution and never affects
// pass/fail evaluation or threshold logic (research.md §8, contracts/uptime-internal-api.md).
export async function runCheck(
  env: Env,
  checkId: string,
  trigger: CheckTrigger,
): Promise<RunCheckResult | null> {
  const check = await env.DB
    .prepare(
      `SELECT id, name, type, target, failure_threshold, recovery_threshold, webhook_url
       FROM checks WHERE id = ?1`,
    )
    .bind(checkId)
    .first<CheckRow>();
  if (!check) return null;

  const outcome = check.type === "tcp"
    ? await runTcpCheck(check.target)
    : await runHttpCheck(check.target);

  await env.DB
    .prepare(
      `INSERT INTO check_runs (id, check_id, trigger, succeeded, latency_ms, detail)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      crypto.randomUUID(),
      checkId,
      trigger,
      outcome.succeeded ? 1 : 0,
      outcome.latencyMs,
      outcome.detail,
    )
    .run();

  // Atomic read-modify-write in one statement (spec Edge Cases: overlapping scheduled/manual runs
  // of the same check must never corrupt consecutive-failure/recovery counting) — mirrors
  // decide.ts's applyOutcome() exactly, but computed by SQLite against the row's live value at
  // write time rather than a JS value read moments earlier, which two concurrent runCheck() calls
  // for the same check could otherwise race on between their own SELECT and UPDATE.
  const updated = await env.DB
    .prepare(
      `UPDATE checks SET
         consecutive_failures = CASE WHEN ?2 = 1 THEN 0 ELSE consecutive_failures + 1 END,
         consecutive_successes = CASE WHEN ?2 = 1 THEN consecutive_successes + 1 ELSE 0 END,
         status = CASE WHEN ?2 = 1 THEN 'up' ELSE 'down' END
       WHERE id = ?1
       RETURNING consecutive_failures, consecutive_successes`,
    )
    .bind(checkId, outcome.succeeded ? 1 : 0)
    .first<UpdatedCounters>();

  const crossesFailureThreshold = !outcome.succeeded &&
    (updated?.consecutive_failures ?? 0) >= check.failure_threshold;
  const crossesRecoveryThreshold = outcome.succeeded &&
    (updated?.consecutive_successes ?? 0) >= check.recovery_threshold;

  let incidentOpened = false;
  let incidentResolved = false;
  let incidentId: string | null = null;

  if (crossesFailureThreshold) {
    incidentId = crypto.randomUUID();
    // "WHERE NOT EXISTS" guard, not a prior application-level read — the only way to guarantee
    // exactly one open incident per outage even if multiple concurrent runs cross the threshold
    // together (spec FR-007).
    const result = await env.DB
      .prepare(
        `INSERT INTO incidents (id, check_id)
         SELECT ?1, ?2 WHERE NOT EXISTS (
           SELECT 1 FROM incidents WHERE check_id = ?2 AND resolved_at IS NULL
         )`,
      )
      .bind(incidentId, checkId)
      .run();
    incidentOpened = (result.meta.changes ?? 0) > 0;
  } else if (crossesRecoveryThreshold) {
    const openIncident = await env.DB
      .prepare(`SELECT id FROM incidents WHERE check_id = ?1 AND resolved_at IS NULL`)
      .bind(checkId)
      .first<{ id: string }>();
    if (openIncident) {
      const result = await env.DB
        .prepare(
          `UPDATE incidents SET resolved_at = datetime('now')
           WHERE check_id = ?1 AND resolved_at IS NULL`,
        )
        .bind(checkId)
        .run();
      incidentResolved = (result.meta.changes ?? 0) > 0;
      incidentId = openIncident.id;
    }
  }

  if ((incidentOpened || incidentResolved) && check.webhook_url && incidentId) {
    await deliverWebhook(check.webhook_url, {
      checkId,
      checkName: check.name,
      event: incidentOpened ? "incident.opened" : "incident.resolved",
      incidentId,
    });
  }

  return {
    succeeded: outcome.succeeded,
    latencyMs: outcome.latencyMs,
    detail: outcome.detail,
    status: outcome.succeeded ? "up" : "down",
    incidentOpened,
    incidentResolved,
  };
}
