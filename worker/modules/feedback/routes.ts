import { Hono } from "hono";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";
import { resolveRequestedProject } from "../projects/resolve.ts";

interface Env {
  DB: D1Database;
}

export const feedbackRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

feedbackRoutes.use("*", sessionAuth);

interface FeedbackListRow {
  id: string;
  message: string;
  name: string | null;
  contact_email: string | null;
  source: string;
  issue_id: string | null;
  received_at: string;
}

feedbackRoutes.get("/", async (c) => {
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.json({ feedback: [] });

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, message, name, contact_email, source, issue_id, received_at
       FROM feedback WHERE project_id = ?1 ORDER BY received_at DESC`,
    )
    .bind(project.id)
    .all<FeedbackListRow>();

  return c.json({
    feedback: (results ?? []).map((row) => ({
      id: row.id,
      message: row.message,
      name: row.name,
      contactEmail: row.contact_email,
      source: row.source,
      issueId: row.issue_id,
      receivedAt: row.received_at,
    })),
  });
});

interface FeedbackDetailRow {
  id: string;
  message: string;
  name: string | null;
  contact_email: string | null;
  url: string | null;
  source: string;
  received_at: string;
  issue_id: string | null;
  issue_title: string | null;
}

feedbackRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.text("Not Found", 404);

  const row = await c.env.DB
    .prepare(
      `SELECT f.id, f.message, f.name, f.contact_email, f.url, f.source, f.received_at,
              f.issue_id, i.title as issue_title
       FROM feedback f LEFT JOIN issues i ON i.id = f.issue_id
       WHERE f.id = ?1 AND f.project_id = ?2`,
    )
    .bind(id, project.id)
    .first<FeedbackDetailRow>();
  if (!row) return c.text("Not Found", 404);

  return c.json({
    id: row.id,
    message: row.message,
    name: row.name,
    contactEmail: row.contact_email,
    url: row.url,
    source: row.source,
    receivedAt: row.received_at,
    issue: row.issue_id ? { id: row.issue_id, title: row.issue_title } : null,
  });
});
