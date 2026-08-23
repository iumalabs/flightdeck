import { Hono } from "hono";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

export const identityRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

identityRoutes.use("*", sessionAuth);

identityRoutes.get("/me", (c) => {
  const identity = c.get("identity");
  return c.json({ sub: identity.sub, email: identity.email, role: identity.role });
});

interface ProjectRow {
  id: string;
  name: string;
  dsn_public_key: string;
}

// The DSN's public key is, per its name, public — meant to be embedded directly in client-side
// SDK code (issues/24), unlike the API tokens/log-export credentials elsewhere in this app that
// really are secrets shown once. Returning it here (not just at creation time) is what lets
// InstallSdkScreen render a real, working DSN for a project created in an earlier session.
identityRoutes.get("/projects", async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT id, name, dsn_public_key FROM projects ORDER BY created_at ASC`)
    .all<ProjectRow>();
  const host = new URL(c.req.url).host;
  return c.json({
    projects: (results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      dsn: `https://${row.dsn_public_key}@${host}/${row.id}`,
    })),
  });
});
