import { Hono } from "hono";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";

interface Env {
  DB: D1Database;
}

export const githubRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

githubRoutes.use("*", sessionAuth);

interface ConnectBody {
  installationId?: string;
  owner?: string;
  repo?: string;
}

// contracts/internal-api.md's POST /api/internal/projects/{id}/github/connect — records the
// result of GitHub's own App installation flow (research.md §10); FlightDeck never handles the
// installation itself.
githubRoutes.post("/:id/github/connect", async (c) => {
  const projectId = c.req.param("id");
  const body = await c.req.json().catch(() => null) as ConnectBody | null;
  if (
    !body || typeof body.installationId !== "string" || typeof body.owner !== "string" ||
    typeof body.repo !== "string"
  ) {
    return c.text("Bad Request", 400);
  }

  // spec FR-009: exactly one connection per project.
  await c.env.DB
    .prepare(
      `INSERT INTO repository_connections (project_id, owner, repo, installation_id)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(project_id) DO UPDATE SET
         owner = ?2, repo = ?3, installation_id = ?4, connected_at = datetime('now')`,
    )
    .bind(projectId, body.owner, body.repo, body.installationId)
    .run();

  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      identity.sub,
      "github.connect",
      JSON.stringify({ projectId, owner: body.owner, repo: body.repo }),
    )
    .run();

  return c.json({ owner: body.owner, repo: body.repo }, 200);
});

// contracts/internal-api.md's DELETE /api/internal/projects/{id}/github — idempotent, 200 even
// when nothing was connected.
githubRoutes.delete("/:id/github", async (c) => {
  const projectId = c.req.param("id");
  await c.env.DB
    .prepare(`DELETE FROM repository_connections WHERE project_id = ?1`)
    .bind(projectId)
    .run();

  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, before_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(crypto.randomUUID(), identity.sub, "github.disconnect", JSON.stringify({ projectId }))
    .run();

  return c.body(null, 200);
});
