import { Hono } from "hono";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";

interface Env {
  DB: D1Database;
  SOURCE_MAPS: R2Bucket;
}

export const projectsRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

projectsRoutes.use("*", sessionAuth);

// Generous enough for a real source map (can run to low single-digit MB), bounded per
// contracts/internal-api.md's documented 413 response.
const MAX_SOURCE_MAP_BYTES = 5_000_000;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface ReleaseRow {
  id: string;
}

// contracts/internal-api.md's POST /api/internal/projects/{id}/source-maps — research.md §7's
// deliberately-not-sentry-cli-shaped minimal upload endpoint.
projectsRoutes.post("/:id/source-maps", async (c) => {
  const projectId = c.req.param("id");
  const body = await c.req.parseBody();
  const release = body["release"];
  const minifiedPathPattern = body["minifiedPathPattern"];
  const file = body["file"];

  if (
    typeof release !== "string" || typeof minifiedPathPattern !== "string" ||
    !(file instanceof File)
  ) {
    return c.text("Bad Request", 400);
  }
  if (file.size > MAX_SOURCE_MAP_BYTES) {
    return c.text("Payload Too Large", 413);
  }

  // Implicitly creates the release row if it doesn't exist yet (data-model.md's Edge Case).
  let releaseRow = await c.env.DB
    .prepare(`SELECT id FROM releases WHERE project_id = ?1 AND version = ?2`)
    .bind(projectId, release)
    .first<ReleaseRow>();
  if (!releaseRow) {
    const releaseId = crypto.randomUUID();
    await c.env.DB
      .prepare(`INSERT INTO releases (id, project_id, version) VALUES (?1, ?2, ?3)`)
      .bind(releaseId, projectId, release)
      .run();
    releaseRow = { id: releaseId };
  }

  // research.md §7's object key scheme: {project_id}/{release}/{sha256(minified-path-pattern)}.
  const objectKey = `${projectId}/${release}/${await sha256Hex(minifiedPathPattern)}`;
  await c.env.SOURCE_MAPS.put(objectKey, await file.arrayBuffer());

  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO source_maps (id, project_id, release_id, minified_path_pattern, r2_object_key)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(id, projectId, releaseRow.id, minifiedPathPattern, objectKey)
    .run();

  // Constitution Principle X — every admin mutation is recorded.
  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      identity.sub,
      "source_map.upload",
      JSON.stringify({ projectId, release, minifiedPathPattern, sourceMapId: id }),
    )
    .run();

  return c.json({ id }, 201);
});
