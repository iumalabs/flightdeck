import { Hono } from "hono";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";
import type { Breadcrumb, EventPayload, StackFrame } from "../ingest/types.ts";
import { deriveCulpritFrame } from "../ingest/fingerprint.ts";
import { lookupSuspectCommit } from "../github/suspect-commit.ts";

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
}

// contracts/internal-api.md (specs/002-error-monitoring) — scoped to whatever project(s) the
// caller's session can see. Module 1/2 only ever seed the single "demo" project, so this isn't
// filtered by an explicit project selector yet; that's a later module's concern.
issuesRoutes.get("/", async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, title, culprit, level, event_count, first_seen, last_seen
       FROM issues
       ORDER BY last_seen DESC`,
    )
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
    })),
  });
});

interface EventRow {
  payload: string;
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
  const issue = await c.env.DB
    .prepare(
      `SELECT id, project_id, title, culprit, level, event_count, first_seen, last_seen
       FROM issues WHERE id = ?1`,
    )
    .bind(id)
    .first<IssueRow>();

  if (!issue) {
    return c.text("Not Found", 404);
  }

  const latestEventRow = await c.env.DB
    .prepare(
      `SELECT payload FROM events WHERE issue_id = ?1 ORDER BY received_at DESC LIMIT 1`,
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

  return c.json({
    id: issue.id,
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level,
    eventCount: issue.event_count,
    firstSeen: issue.first_seen,
    lastSeen: issue.last_seen,
    latestEvent,
    suspectCommit,
  });
});
