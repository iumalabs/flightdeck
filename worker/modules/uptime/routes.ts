import { Hono } from "hono";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";
import { runCheck } from "./evaluate.ts";
import { resolveRequestedProject } from "../projects/resolve.ts";
import { createCheck, MIN_INTERVAL_SECONDS } from "./create-check.ts";

interface Env {
  DB: D1Database;
}

export const uptimeRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

uptimeRoutes.use("*", sessionAuth);

interface CheckRow {
  id: string;
  name: string;
  type: string;
  target: string;
  interval_seconds: number;
  failure_threshold: number;
  recovery_threshold: number;
  webhook_url: string | null;
  status: string;
}

interface UptimeStats {
  total: number;
  succeeded: number;
}

// contracts/uptime-internal-api.md's `uptimePercent` — over whatever check_runs history is
// currently retained (bounded by the 30-day retention window, research.md §5), null (not 0 or 100)
// when there's no history yet, matching this project's established "honest no-data state"
// convention (specs/005-releases release-health.ts's computeCrashFreeRate).
async function computeUptimePercent(db: D1Database, checkId: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as total, SUM(succeeded) as succeeded FROM check_runs WHERE check_id = ?1`,
    )
    .bind(checkId)
    .first<UptimeStats>();
  if (!row || row.total === 0) return null;
  return (row.succeeded / row.total) * 100;
}

uptimeRoutes.get("/checks", async (c) => {
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.json({ checks: [] });

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, name, type, target, status FROM checks WHERE project_id = ?1 ORDER BY created_at DESC`,
    )
    .bind(project.id)
    .all<Pick<CheckRow, "id" | "name" | "type" | "target" | "status">>();

  const checks = await Promise.all(
    (results ?? []).map(async (row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      target: row.target,
      status: row.status,
      uptimePercent: await computeUptimePercent(c.env.DB, row.id),
    })),
  );

  return c.json({ checks });
});

interface CreateCheckBody {
  name?: string;
  type?: string;
  target?: string;
  intervalSeconds?: number;
  failureThreshold?: number;
  recoveryThreshold?: number;
  webhookUrl?: string;
}

uptimeRoutes.post("/checks", async (c) => {
  const body = await c.req.json().catch(() => null) as CreateCheckBody | null;
  if (
    !body || typeof body.name !== "string" || !body.name ||
    (body.type !== "http" && body.type !== "tcp") ||
    typeof body.target !== "string" || !body.target ||
    typeof body.intervalSeconds !== "number"
  ) {
    return c.text("Bad Request", 400);
  }
  if (body.intervalSeconds < MIN_INTERVAL_SECONDS) {
    return c.text("Bad Request", 400);
  }

  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.text("Not Found", 404);

  const created = await createCheck(c.env.DB, project.id, {
    name: body.name,
    type: body.type,
    target: body.target,
    intervalSeconds: body.intervalSeconds,
    failureThreshold: body.failureThreshold,
    recoveryThreshold: body.recoveryThreshold,
    webhookUrl: body.webhookUrl,
  });
  if (created === "limit-reached") {
    return c.text("Forbidden", 403);
  }

  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      identity.sub,
      "check.create",
      JSON.stringify({
        checkId: created.id,
        name: created.name,
        type: created.type,
        target: created.target,
      }),
    )
    .run();

  return c.json({
    id: created.id,
    name: created.name,
    type: created.type,
    target: created.target,
    intervalSeconds: created.intervalSeconds,
    failureThreshold: created.failureThreshold,
    recoveryThreshold: created.recoveryThreshold,
    webhookUrl: created.webhookUrl,
    status: "unknown",
    uptimePercent: null,
  }, 201);
});

interface RecentRunRow {
  trigger: string;
  succeeded: number;
  latency_ms: number | null;
  detail: string | null;
  run_at: string;
}

interface IncidentRow {
  id: string;
  opened_at: string;
  resolved_at: string | null;
}

const RECENT_RUNS_LIMIT = 50;

uptimeRoutes.get("/checks/:id", async (c) => {
  const id = c.req.param("id");
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.text("Not Found", 404);

  const check = await c.env.DB
    .prepare(
      `SELECT id, name, type, target, interval_seconds, failure_threshold, recovery_threshold, webhook_url, status
       FROM checks WHERE id = ?1 AND project_id = ?2`,
    )
    .bind(id, project.id)
    .first<CheckRow>();
  if (!check) return c.text("Not Found", 404);

  const { results: recentRuns } = await c.env.DB
    .prepare(
      `SELECT trigger, succeeded, latency_ms, detail, run_at FROM check_runs
       WHERE check_id = ?1 ORDER BY run_at DESC LIMIT ?2`,
    )
    .bind(id, RECENT_RUNS_LIMIT)
    .all<RecentRunRow>();

  const { results: incidents } = await c.env.DB
    .prepare(
      `SELECT id, opened_at, resolved_at FROM incidents WHERE check_id = ?1 ORDER BY opened_at DESC`,
    )
    .bind(id)
    .all<IncidentRow>();

  return c.json({
    id: check.id,
    name: check.name,
    type: check.type,
    target: check.target,
    intervalSeconds: check.interval_seconds,
    failureThreshold: check.failure_threshold,
    recoveryThreshold: check.recovery_threshold,
    webhookUrl: check.webhook_url,
    status: check.status,
    uptimePercent: await computeUptimePercent(c.env.DB, id),
    recentRuns: (recentRuns ?? []).map((r) => ({
      trigger: r.trigger,
      succeeded: r.succeeded === 1,
      latencyMs: r.latency_ms,
      detail: r.detail,
      runAt: r.run_at,
    })),
    incidents: (incidents ?? []).map((i) => ({
      id: i.id,
      openedAt: i.opened_at,
      resolvedAt: i.resolved_at,
    })),
  });
});

interface UpdateCheckBody {
  name?: string;
  target?: string;
  intervalSeconds?: number;
  failureThreshold?: number;
  recoveryThreshold?: number;
  webhookUrl?: string | null;
}

uptimeRoutes.patch("/checks/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as UpdateCheckBody | null;
  if (!body) return c.text("Bad Request", 400);
  if (body.intervalSeconds !== undefined && body.intervalSeconds < MIN_INTERVAL_SECONDS) {
    return c.text("Bad Request", 400);
  }

  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.text("Not Found", 404);

  const existing = await c.env.DB
    .prepare(
      `SELECT name, target, interval_seconds, failure_threshold, recovery_threshold, webhook_url
       FROM checks WHERE id = ?1 AND project_id = ?2`,
    )
    .bind(id, project.id)
    .first<
      {
        name: string;
        target: string;
        interval_seconds: number;
        failure_threshold: number;
        recovery_threshold: number;
        webhook_url: string | null;
      }
    >();
  if (!existing) return c.text("Not Found", 404);

  // A bare COALESCE(?, column) can't tell "field omitted" from "field explicitly cleared to
  // null" (found live: a PATCH that only touches `target` was silently wiping `webhookUrl` to
  // null, since an omitted JSON field and an explicit null both bind as SQL NULL) — merge in JS
  // first, where `undefined` (omitted) and `null` (explicit clear) are still distinguishable.
  const merged = {
    name: body.name ?? existing.name,
    target: body.target ?? existing.target,
    intervalSeconds: body.intervalSeconds ?? existing.interval_seconds,
    failureThreshold: body.failureThreshold ?? existing.failure_threshold,
    recoveryThreshold: body.recoveryThreshold ?? existing.recovery_threshold,
    webhookUrl: body.webhookUrl !== undefined ? body.webhookUrl : existing.webhook_url,
  };

  await c.env.DB
    .prepare(
      `UPDATE checks SET
         name = ?2, target = ?3, interval_seconds = ?4,
         failure_threshold = ?5, recovery_threshold = ?6, webhook_url = ?7
       WHERE id = ?1`,
    )
    .bind(
      id,
      merged.name,
      merged.target,
      merged.intervalSeconds,
      merged.failureThreshold,
      merged.recoveryThreshold,
      merged.webhookUrl,
    )
    .run();

  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      identity.sub,
      "check.update",
      JSON.stringify({ checkId: id, ...body }),
    )
    .run();

  const updated = await c.env.DB
    .prepare(
      `SELECT id, name, type, target, interval_seconds, failure_threshold, recovery_threshold, webhook_url, status
       FROM checks WHERE id = ?1`,
    )
    .bind(id)
    .first<CheckRow>();

  return c.json({
    id: updated!.id,
    name: updated!.name,
    type: updated!.type,
    target: updated!.target,
    intervalSeconds: updated!.interval_seconds,
    failureThreshold: updated!.failure_threshold,
    recoveryThreshold: updated!.recovery_threshold,
    webhookUrl: updated!.webhook_url,
    status: updated!.status,
  });
});

// research.md §6 — deletion auto-resolves any open incident as part of the same operation, rather
// than leaving it dangling with no owning check or blocking the delete (spec Edge Cases). Live-
// verified correction: `check_runs`/`incidents` both carry a REFERENCES checks(id) FK that D1
// enforces, so a bare `DELETE FROM checks` 500s with a FOREIGN KEY constraint failure while either
// table still has rows for this check — cascading the delete to both (in FK-dependency order,
// inside one batch) is what "not left dangling" resolves to once a real delete, not just an
// open->resolved status flip, is required.
uptimeRoutes.delete("/checks/:id", async (c) => {
  const id = c.req.param("id");
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.text("Not Found", 404);

  const existing = await c.env.DB
    .prepare(`SELECT id FROM checks WHERE id = ?1 AND project_id = ?2`)
    .bind(id, project.id)
    .first();
  if (!existing) return c.text("Not Found", 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM check_runs WHERE check_id = ?1`).bind(id),
    c.env.DB.prepare(`DELETE FROM incidents WHERE check_id = ?1`).bind(id),
    c.env.DB.prepare(`DELETE FROM checks WHERE id = ?1`).bind(id),
  ]);

  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, before_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(crypto.randomUUID(), identity.sub, "check.delete", JSON.stringify({ checkId: id }))
    .run();

  return c.body(null, 200);
});

// constitution Principle V — calls the exact same runCheck() the scheduled() handler's uptime case
// calls (worker/index.ts), differing only in trigger: "interactive" (research.md §8).
uptimeRoutes.post("/checks/:id/trigger", async (c) => {
  const id = c.req.param("id");
  const result = await runCheck(c.env, id, "interactive");
  if (!result) return c.text("Not Found", 404);
  return c.json(result);
});

interface IncidentListRow {
  id: string;
  check_id: string;
  check_name: string;
  opened_at: string;
  resolved_at: string | null;
}

uptimeRoutes.get("/incidents", async (c) => {
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.json({ incidents: [] });

  const { results } = await c.env.DB
    .prepare(
      `SELECT i.id, i.check_id, c.name as check_name, i.opened_at, i.resolved_at
       FROM incidents i JOIN checks c ON c.id = i.check_id
       WHERE c.project_id = ?1 ORDER BY i.opened_at DESC`,
    )
    .bind(project.id)
    .all<IncidentListRow>();

  return c.json({
    incidents: (results ?? []).map((row) => ({
      id: row.id,
      checkId: row.check_id,
      checkName: row.check_name,
      openedAt: row.opened_at,
      resolvedAt: row.resolved_at,
    })),
  });
});
