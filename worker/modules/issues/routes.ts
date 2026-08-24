import { Hono } from "hono";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";
import type { Breadcrumb, EventPayload, StackFrame } from "../ingest/types.ts";
import { deriveCulpritFrame } from "../ingest/fingerprint.ts";
import { lookupSuspectCommit } from "../github/suspect-commit.ts";
import { resolveRequestedProject } from "../projects/resolve.ts";

interface Env {
  DB: D1Database;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}

export const issuesRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

issuesRoutes.use("*", sessionAuth);

interface IssueRow {
  id: string;
  project_id: string;
  title: string;
  culprit: string | null;
  level: string;
  event_count: number;
  first_seen: string;
  last_seen: string;
  status: string;
  resolved_release_id: string | null;
}

// contracts/internal-api.md (specs/002-error-monitoring), scoped by ?project= (specs/008-multi-
// project-support research.md §2 — this route previously had NO project filter at all).
// specs/005-releases: defaults to the active-issues view (status = 'unresolved', spec.md
// Acceptance Scenario 1) — ?status=all shows everything, including resolved ones.
issuesRoutes.get("/", async (c) => {
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.json({ issues: [] });

  const showAll = c.req.query("status") === "all";
  const { results } = await c.env.DB
    .prepare(
      showAll
        ? `SELECT id, title, culprit, level, event_count, first_seen, last_seen, status, resolved_release_id
           FROM issues WHERE project_id = ?1 ORDER BY last_seen DESC`
        : `SELECT id, title, culprit, level, event_count, first_seen, last_seen, status, resolved_release_id
           FROM issues WHERE project_id = ?1 AND status = 'unresolved' ORDER BY last_seen DESC`,
    )
    .bind(project.id)
    .all<IssueRow>();

  return c.json({
    issues: (results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      culprit: row.culprit,
      level: row.level,
      eventCount: row.event_count,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      status: row.status,
      // A "regressed" indicator is inferred from the current state (data-model.md,
      // specs/005-releases research.md §9) — unresolved but with a resolution history.
      regressed: row.status === "unresolved" && row.resolved_release_id !== null,
    })),
  });
});

interface EventRow {
  payload: string;
  trace_id: string | null;
}

interface LatestEvent {
  stacktrace: { frames?: StackFrame[] } | null;
  breadcrumbs: Breadcrumb[];
  tags: Record<string, string>;
  contexts: Record<string, unknown>;
}

export function shapeLatestEvent(payload: EventPayload): LatestEvent {
  const exceptionValue = payload.exception?.values?.at(-1);
  const breadcrumbs = Array.isArray(payload.breadcrumbs)
    ? payload.breadcrumbs
    : payload.breadcrumbs?.values ?? [];

  return {
    stacktrace: exceptionValue?.stacktrace ?? null,
    breadcrumbs,
    tags: payload.tags ?? {},
    contexts: payload.contexts ?? {},
  };
}

// contracts/internal-api.md's GET /api/internal/issues/{id} — the latest event's stack trace,
// breadcrumbs, and tags/context, plus the suspect commit (spec FR-011, research.md §10) when a
// GitHub repo is connected.
issuesRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.text("Not Found", 404);

  const issue = await c.env.DB
    .prepare(
      `SELECT id, project_id, title, culprit, level, event_count, first_seen, last_seen, status, resolved_release_id
       FROM issues WHERE id = ?1 AND project_id = ?2`,
    )
    .bind(id, project.id)
    .first<IssueRow>();

  if (!issue) {
    return c.text("Not Found", 404);
  }

  const latestEventRow = await c.env.DB
    .prepare(
      `SELECT payload, trace_id FROM events WHERE issue_id = ?1 ORDER BY received_at DESC LIMIT 1`,
    )
    .bind(id)
    .first<EventRow>();

  let latestEvent: LatestEvent | null = null;
  let culpritFrame: StackFrame | null = null;
  if (latestEventRow) {
    try {
      const payload = JSON.parse(latestEventRow.payload) as EventPayload;
      latestEvent = shapeLatestEvent(payload);
      culpritFrame = deriveCulpritFrame(payload);
    } catch {
      latestEvent = null;
    }
  }

  const suspectCommit = await lookupSuspectCommit(
    c.env.DB,
    c.env,
    issue.project_id,
    culpritFrame?.filename,
  );

  // contracts/feedback-internal-api.md's addition (specs/007-user-feedback) — non-empty only when
  // at least one Feedback row's issue_id matches (FR-008); an empty array is what tells the
  // frontend to render no feedback section at all, not an empty-state placeholder.
  const { results: feedbackRows } = await c.env.DB
    .prepare(
      `SELECT id, message, name, contact_email, received_at
       FROM feedback WHERE issue_id = ?1 ORDER BY received_at DESC`,
    )
    .bind(id)
    .all<
      {
        id: string;
        message: string;
        name: string | null;
        contact_email: string | null;
        received_at: string;
      }
    >();

  return c.json({
    id: issue.id,
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level,
    eventCount: issue.event_count,
    firstSeen: issue.first_seen,
    lastSeen: issue.last_seen,
    latestEvent,
    // T050 (specs/002-error-monitoring Phase 8 Convergence, spec.md's Edge Case "An issue's only
    // recorded occurrence ages past the retention window" / FR-015) — distinguishes "no
    // stack trace/breadcrumbs were ever recorded" (an events row exists, its payload just never
    // carried that data) from "this issue's only occurrence(s) aged out under retention" (no
    // events row exists at all for this issue, even though `event_count` — which retention never
    // decrements, worker/modules/ingest/retention.ts's pruneOldEvents deletes from `events` only —
    // proves at least one WAS ingested). Every issue's `event_count` starts at 1 at creation
    // (routes.ts's "event" item dispatch inserts the issue and its first event together), so a
    // missing `latestEventRow` here can only mean retention pruned it, never "no event ever
    // existed."
    eventDataRetained: latestEventRow !== null,
    suspectCommit,
    // contracts/traces-internal-api.md's addition (specs/003-distributed-tracing) — the latest
    // event's trace_id, null when it carried no contexts.trace (spec FR-009, "absent, not an
    // error state").
    traceId: latestEventRow?.trace_id ?? null,
    status: issue.status,
    regressed: issue.status === "unresolved" && issue.resolved_release_id !== null,
    feedback: (feedbackRows ?? []).map((row) => ({
      id: row.id,
      message: row.message,
      name: row.name,
      contactEmail: row.contact_email,
      receivedAt: row.received_at,
    })),
  });
});

interface ResolveBody {
  mode?: "exact" | "next-release";
  releaseId?: string;
}

// contracts/releases-internal-api.md's POST /api/internal/issues/{id}/resolve (specs/005-releases).
issuesRoutes.post("/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as ResolveBody | null;
  if (!body || (body.mode !== "exact" && body.mode !== "next-release")) {
    return c.text("Bad Request", 400);
  }

  const issue = await c.env.DB
    .prepare(`SELECT id, project_id FROM issues WHERE id = ?1`)
    .bind(id)
    .first<{ id: string; project_id: string }>();
  if (!issue) return c.text("Not Found", 404);

  let releaseId = body.releaseId ?? null;
  if (body.mode === "exact" && !releaseId) {
    // Defaults to the issue's most-recently-seen event's release, when determinable
    // (contracts/releases-internal-api.md).
    const latest = await c.env.DB
      .prepare(
        `SELECT r.id FROM events e
         JOIN releases r ON r.project_id = e.project_id AND r.version = e.release
         WHERE e.issue_id = ?1 ORDER BY e.received_at DESC LIMIT 1`,
      )
      .bind(id)
      .first<{ id: string }>();
    releaseId = latest?.id ?? null;
  } else if (body.mode === "next-release") {
    // The resolution-time latest known release (research.md §7) — the comparison basis is
    // recomputed relative to THIS at regression-check time, not fixed at resolve time.
    const latest = await c.env.DB
      .prepare(`SELECT id FROM releases WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 1`)
      .bind(issue.project_id)
      .first<{ id: string }>();
    releaseId = latest?.id ?? null;
  }

  await c.env.DB
    .prepare(
      `UPDATE issues SET status = 'resolved', resolved_release_id = ?2, resolved_mode = ?3 WHERE id = ?1`,
    )
    .bind(id, releaseId, body.mode)
    .run();

  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      identity.sub,
      "issue.resolve",
      JSON.stringify({ issueId: id, mode: body.mode, releaseId }),
    )
    .run();

  return c.json({ status: "resolved", resolvedReleaseId: releaseId, resolvedMode: body.mode });
});
