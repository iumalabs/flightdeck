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

identityRoutes.get("/projects", async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT id, name FROM projects ORDER BY created_at ASC`)
    .all<{ id: string; name: string }>();
  return c.json({ projects: results });
});
