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

interface CreateProjectBody {
  name?: string;
}

interface CreatedProjectRow {
  id: string;
  name: string;
  dsn_public_key: string;
}

// contracts/projects-internal-api.md's POST /api/internal/projects (specs/008-multi-project-support)
// — dsn_public_key generated via the exact SQL expression migration 0002 already uses to backfill
// "demo"'s own key (research.md §3), not a JS-computed value passed in.
projectsRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null) as CreateProjectBody | null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return c.text("Bad Request", 400);
  }

  // migration 0009: `projects.id` is D1/SQLite's native INTEGER PRIMARY KEY (rowid alias) now, not
  // a `crypto.randomUUID()` value — required so an issued DSN's project-id path segment actually
  // matches the real @sentry/core SDK's own /^\d+$/ validation. `id` is omitted from the INSERT
  // list entirely and left for SQLite to auto-assign; `RETURNING CAST(id AS TEXT) AS id` keeps the
  // rest of this handler (and every caller of this response) working with the same opaque string
  // shape a project id has always had.
  const row = await c.env.DB
    .prepare(
      `INSERT INTO projects (name, dsn_public_key)
       VALUES (?1, lower(hex(randomblob(16))))
       RETURNING CAST(id AS TEXT) AS id, name, dsn_public_key`,
    )
    .bind(body.name.trim())
    .first<CreatedProjectRow>();
  if (!row) return c.text("Internal Server Error", 500); // shouldn't happen — defensive

  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      identity.sub,
      "project.create",
      JSON.stringify({ projectId: row.id, name: row.name }),
    )
    .run();

  // research.md §3 — host derived from the request itself, correct in local/preview/production
  // alike, never hardcoded to the production custom domain.
  const host = new URL(c.req.url).host;
  const dsn = `https://${row.dsn_public_key}@${host}/${row.id}`;

  return c.json({ id: row.id, name: row.name, dsn }, 201);
});

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
