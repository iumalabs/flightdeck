import { applyOutcome } from "./decide.ts";
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
  consecutive_failures: number;
  consecutive_successes: number;
}

// Bounded — a real conflict (another overlapping run for the SAME check writing between our SELECT
// and UPDATE) should resolve within a couple of retries; this is a ceiling against something else
// being wrong, not a tuning knob expected to matter in practice (research.md §8's "overlapping
// scheduled/manual runs" edge case names two, not an unbounded stampede).
const MAX_COUNTER_UPDATE_ATTEMPTS = 5;

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
      `SELECT id, name, type, target, failure_threshold, recovery_threshold, webhook_url,
              consecutive_failures, consecutive_successes
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

  // T038 (specs/006-uptime-monitoring Phase 8 Convergence) — runCheck() now actually calls
  // decide.ts's applyOutcome() (the single source of truth for the consecutive-failure/recovery
  // counter semantics) instead of a hand-duplicated, parallel SQL CASE expression that could
  // silently diverge from it. Race-safety under overlapping scheduled/manual runs of the SAME
  // check (spec Edge Cases) — previously guaranteed by a single atomic SQL statement — is now an
  // optimistic-concurrency retry: the UPDATE's WHERE clause only succeeds if the row's counters
  // still match what we read; a concurrent run winning that race makes ours a no-op (0 rows
  // changed), so we re-read the row's now-current counters and recompute via applyOutcome() again,
  // bounded by MAX_COUNTER_UPDATE_ATTEMPTS.
  let counters = {
    consecutiveFailures: check.consecutive_failures,
    consecutiveSuccesses: check.consecutive_successes,
  };
  const thresholds = {
    failureThreshold: check.failure_threshold,
    recoveryThreshold: check.recovery_threshold,
  };
  let transition = applyOutcome(counters, thresholds, outcome.succeeded);

  for (let attempt = 1; attempt <= MAX_COUNTER_UPDATE_ATTEMPTS; attempt++) {
    const result = await env.DB
      .prepare(
        `UPDATE checks SET
           consecutive_failures = ?2, consecutive_successes = ?3, status = ?4
         WHERE id = ?1 AND consecutive_failures = ?5 AND consecutive_successes = ?6`,
      )
      .bind(
        checkId,
        transition.consecutiveFailures,
        transition.consecutiveSuccesses,
        transition.status,
        counters.consecutiveFailures,
        counters.consecutiveSuccesses,
      )
      .run();
    if ((result.meta.changes ?? 0) > 0) break;

    if (attempt === MAX_COUNTER_UPDATE_ATTEMPTS) {
      throw new Error(
        `runCheck: exhausted ${MAX_COUNTER_UPDATE_ATTEMPTS} attempts updating counters for check ${checkId} — persistent concurrent writer contention`,
      );
    }
    const fresh = await env.DB
      .prepare(
        `SELECT consecutive_failures, consecutive_successes FROM checks WHERE id = ?1`,
      )
      .bind(checkId)
      .first<{ consecutive_failures: number; consecutive_successes: number }>();
    if (!fresh) return null; // the check was deleted mid-run
    counters = {
      consecutiveFailures: fresh.consecutive_failures,
      consecutiveSuccesses: fresh.consecutive_successes,
    };
    transition = applyOutcome(counters, thresholds, outcome.succeeded);
  }

  const crossesFailureThreshold = transition.crossesFailureThreshold;
  const crossesRecoveryThreshold = transition.crossesRecoveryThreshold;

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
