import { Hono } from "hono";
import { apiTokenAuth } from "../../auth/api-token.ts";
import type { ApiTokenIdentity } from "../../auth/api-token.ts";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";
import { generateRawToken, hashToken } from "../../auth/api-token.ts";
import { resolveOrCreateRelease } from "../ingest/release-lookup.ts";
import { computeCrashFreeRate } from "../ingest/release-health.ts";
import { commitsToRows, isProjectAuthorized, isProjectSlugAuthorized } from "./request-shape.ts";
import { resolveRequestedProject } from "../projects/resolve.ts";

interface Env {
  DB: D1Database;
  SOURCE_MAPS: R2Bucket;
  API_TOKEN_PEPPER: string;
}

// ============================================================================
// sentry-cli-compatible surface (contracts/release-management-api.md) —
// apiTokenAuth-gated, `{org_slug}` accepted but never validated (research.md §3).
// ============================================================================

export const releasesCliRoutes = new Hono<
  { Bindings: Env; Variables: { apiToken: ApiTokenIdentity } }
>();

releasesCliRoutes.use("*", apiTokenAuth);

const MAX_SOURCE_MAP_BYTES = 5_000_000;

interface CreateReleaseBody {
  version?: string;
  projects?: string[];
  ref?: string;
  url?: string;
  dateReleased?: string;
}

// `sentry-cli releases new <version>`.
releasesCliRoutes.post("/organizations/:orgSlug/releases/", async (c) => {
  const body = await c.req.json().catch(() => null) as CreateReleaseBody | null;
  if (!body || typeof body.version !== "string" || !Array.isArray(body.projects)) {
    return c.text("Bad Request", 400);
  }

  const apiToken = c.get("apiToken");
  // A token is project-scoped (research.md §4) — reject if none of the requested projects match.
  if (!isProjectAuthorized(apiToken.projectId, body.projects)) {
    return c.text("Forbidden", 403);
  }

  const release = await resolveOrCreateRelease(c.env.DB, apiToken.projectId, body.version);
  if (body.ref || body.url || body.dateReleased) {
    await c.env.DB
      .prepare(
        `UPDATE releases SET ref = COALESCE(?2, ref), url = COALESCE(?3, url), date_released = COALESCE(?4, date_released) WHERE id = ?1`,
      )
      .bind(release.id, body.ref ?? null, body.url ?? null, body.dateReleased ?? null)
      .run();
  }

  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      apiToken.createdBy,
      "release.create",
      JSON.stringify({ projectId: apiToken.projectId, version: body.version }),
    )
    .run();

  return c.json({ version: body.version, dateCreated: release.created_at }, 201);
});

interface UpdateReleaseBody {
  ref?: string;
  url?: string;
  dateReleased?: string;
  commits?: { id?: string; message?: string; author_name?: string }[];
}

// `sentry-cli releases finalize <version>` (sets dateReleased) AND
// `sentry-cli releases set-commits` (sends a `commits` array) — confirmed to be the SAME real
// Sentry endpoint (`PUT .../releases/{version}/`), not two separate ones (research.md §1's
// original framing assumed set-commits needed a server-side GitHub lookup via Module 2's App
// infrastructure; the CONFIRMED endpoint shape instead has the client send commit data directly
// in this same request body, which is simpler and needs no GitHub API call at all — a correction
// made during implementation, see research.md).
releasesCliRoutes.put("/organizations/:orgSlug/releases/:version/", async (c) => {
  const version = c.req.param("version");
  const apiToken = c.get("apiToken");
  const body = await c.req.json().catch(() => null) as UpdateReleaseBody | null;
  if (!body) return c.text("Bad Request", 400);

  const release = await resolveOrCreateRelease(c.env.DB, apiToken.projectId, version);
  const updated = await c.env.DB
    .prepare(
      `UPDATE releases SET ref = COALESCE(?2, ref), url = COALESCE(?3, url), date_released = COALESCE(?4, date_released)
       WHERE id = ?1
       RETURNING date_released`,
    )
    .bind(release.id, body.ref ?? null, body.url ?? null, body.dateReleased ?? null)
    .first<{ date_released: string | null }>();

  if (Array.isArray(body.commits) && body.commits.length > 0) {
    const rows = commitsToRows(body.commits);
    if (rows.length > 0) {
      await c.env.DB.batch(
        rows.map((row) =>
          c.env.DB.prepare(
            `INSERT INTO release_commits (id, release_id, sha, message, author) VALUES (?1, ?2, ?3, ?4, ?5)`,
          ).bind(crypto.randomUUID(), release.id, row.sha, row.message, row.author)
        ),
      );
    }
  }

  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      apiToken.createdBy,
      "release.update",
      JSON.stringify({
        projectId: apiToken.projectId,
        version,
        dateReleased: body.dateReleased ?? null,
      }),
    )
    .run();

  // The release's ACTUAL current state after this update (found live: echoing only what THIS
  // request's body carried was misleading — a set-commits call with no dateReleased of its own
  // would otherwise report dateReleased: null even for an already-finalized release, when the
  // stored value was untouched by COALESCE).
  return c.json({ version, dateReleased: updated?.date_released ?? null }, 200);
});

// `sentry-cli releases files <version> upload-sourcemaps <path>` — additive second front door
// into the SAME source_maps/releases tables Module 2's dashboard upload endpoint writes into
// (worker/modules/projects/routes.ts), not a replacement.
releasesCliRoutes.post(
  "/projects/:orgSlug/:projectSlug/releases/:version/files/",
  async (c) => {
    const projectSlug = c.req.param("projectSlug");
    const version = c.req.param("version");
    const apiToken = c.get("apiToken");
    if (projectSlug !== apiToken.projectId) {
      return c.text("Forbidden", 403);
    }

    const body = await c.req.parseBody();
    const file = body["file"];
    const name = typeof body["name"] === "string" ? body["name"] as string : "~/bundle.js";
    if (!(file instanceof File)) {
      return c.text("Bad Request", 400);
    }
    if (file.size > MAX_SOURCE_MAP_BYTES) {
      return c.text("Payload Too Large", 413);
    }

    const release = await resolveOrCreateRelease(c.env.DB, apiToken.projectId, version);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name));
    const hashHex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    const objectKey = `${apiToken.projectId}/${version}/${hashHex}`;
    await c.env.SOURCE_MAPS.put(objectKey, await file.arrayBuffer());

    const id = crypto.randomUUID();
    await c.env.DB
      .prepare(
        `INSERT INTO source_maps (id, project_id, release_id, minified_path_pattern, r2_object_key)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(id, apiToken.projectId, release.id, name, objectKey)
      .run();

    await c.env.DB
      .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
      .bind(
        crypto.randomUUID(),
        apiToken.createdBy,
        "release.upload_sourcemap",
        JSON.stringify({ projectId: apiToken.projectId, version, sourceMapId: id }),
      )
      .run();

    return c.json({ id }, 201);
  },
);

interface DeployBody {
  environment?: string;
}

// `sentry-cli releases deploys new --release <v> -e <env>`.
releasesCliRoutes.post("/organizations/:orgSlug/releases/:version/deploys/", async (c) => {
  const version = c.req.param("version");
  const apiToken = c.get("apiToken");
  const body = await c.req.json().catch(() => null) as DeployBody | null;
  if (!body || typeof body.environment !== "string") {
    return c.text("Bad Request", 400);
  }

  const release = await resolveOrCreateRelease(c.env.DB, apiToken.projectId, version);
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(`INSERT INTO deploys (id, release_id, environment) VALUES (?1, ?2, ?3)`)
    .bind(id, release.id, body.environment)
    .run();

  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      apiToken.createdBy,
      "release.deploy",
      JSON.stringify({ projectId: apiToken.projectId, version, environment: body.environment }),
    )
    .run();

  return c.json({ id }, 201);
});

interface ReleaseListRow {
  id: string;
  version: string;
  date_released: string | null;
  created_at: string;
}

interface CliReleaseView {
  version: string;
  dateReleased: string | null;
  dateCreated: string;
}

function toCliReleaseView(row: ReleaseListRow): CliReleaseView {
  return { version: row.version, dateReleased: row.date_released, dateCreated: row.created_at };
}

// Shared query helpers backing both the org-scoped (`/organizations/{org_slug}/releases/...`) and
// project-scoped (`/projects/{org_slug}/{project_slug}/releases/...`) path variants (T045,
// research.md §1/§3) — every variant ultimately scopes by `apiToken.projectId`, since a token is
// project-scoped regardless of which path shape a given sentry-cli subcommand happens to use.

// `sentry-cli releases list`.
async function listReleasesForProject(
  db: D1Database,
  projectId: string,
): Promise<CliReleaseView[]> {
  const { results } = await db
    .prepare(
      `SELECT id, version, date_released, created_at FROM releases WHERE project_id = ?1 ORDER BY created_at DESC`,
    )
    .bind(projectId)
    .all<ReleaseListRow>();
  return (results ?? []).map(toCliReleaseView);
}

// `sentry-cli releases list` (single-release retrieve, e.g. via `propose-version`/direct lookup).
async function getReleaseForProject(
  db: D1Database,
  projectId: string,
  version: string,
): Promise<CliReleaseView | null> {
  const row = await db
    .prepare(
      `SELECT id, version, date_released, created_at FROM releases WHERE project_id = ?1 AND version = ?2`,
    )
    .bind(projectId, version)
    .first<ReleaseListRow>();
  return row ? toCliReleaseView(row) : null;
}

// `sentry-cli releases delete <version>`.
async function deleteReleaseForProject(
  db: D1Database,
  projectId: string,
  version: string,
  actorSub: string,
): Promise<void> {
  const release = await db
    .prepare(`SELECT id FROM releases WHERE project_id = ?1 AND version = ?2`)
    .bind(projectId, version)
    .first<{ id: string }>();

  if (release) {
    await db.prepare(`DELETE FROM releases WHERE id = ?1`).bind(release.id).run();
    await db
      .prepare(`INSERT INTO audit_log (id, actor_sub, action, before_json) VALUES (?1, ?2, ?3, ?4)`)
      .bind(
        crypto.randomUUID(),
        actorSub,
        "release.delete",
        JSON.stringify({ projectId, version }),
      )
      .run();
  }
}

// ---- org-scoped variants (`/organizations/{org_slug}/releases/...`) ----

releasesCliRoutes.get("/organizations/:orgSlug/releases/", async (c) => {
  const apiToken = c.get("apiToken");
  const releases = await listReleasesForProject(c.env.DB, apiToken.projectId);
  return c.json(releases);
});

// Org-scoped single-release retrieve (T045, research.md §1's confirmed list/retrieve/delete
// coverage) — `GET /api/0/organizations/{org_slug}/releases/{version}/`.
releasesCliRoutes.get("/organizations/:orgSlug/releases/:version/", async (c) => {
  const apiToken = c.get("apiToken");
  const version = c.req.param("version");
  const release = await getReleaseForProject(c.env.DB, apiToken.projectId, version);
  if (!release) return c.text("Not Found", 404);
  return c.json(release);
});

releasesCliRoutes.delete("/organizations/:orgSlug/releases/:version/", async (c) => {
  const apiToken = c.get("apiToken");
  const version = c.req.param("version");
  await deleteReleaseForProject(c.env.DB, apiToken.projectId, version, apiToken.createdBy);
  return c.body(null, 204);
});

// ---- project-scoped variants (`/projects/{org_slug}/{project_slug}/releases/...`, T045) ----
// Every release-file operation (list/retrieve/delete, unlike creation) has a confirmed
// project-scoped path variant (research.md §3) — `{project_slug}` must match the token's own
// project (`isProjectSlugAuthorized`, mirroring the upload-sourcemaps route below).

releasesCliRoutes.get("/projects/:orgSlug/:projectSlug/releases/", async (c) => {
  const apiToken = c.get("apiToken");
  const projectSlug = c.req.param("projectSlug");
  if (!isProjectSlugAuthorized(apiToken.projectId, projectSlug)) {
    return c.text("Forbidden", 403);
  }
  const releases = await listReleasesForProject(c.env.DB, apiToken.projectId);
  return c.json(releases);
});

releasesCliRoutes.get("/projects/:orgSlug/:projectSlug/releases/:version/", async (c) => {
  const apiToken = c.get("apiToken");
  const projectSlug = c.req.param("projectSlug");
  if (!isProjectSlugAuthorized(apiToken.projectId, projectSlug)) {
    return c.text("Forbidden", 403);
  }
  const version = c.req.param("version");
  const release = await getReleaseForProject(c.env.DB, apiToken.projectId, version);
  if (!release) return c.text("Not Found", 404);
  return c.json(release);
});

releasesCliRoutes.delete("/projects/:orgSlug/:projectSlug/releases/:version/", async (c) => {
  const apiToken = c.get("apiToken");
  const projectSlug = c.req.param("projectSlug");
  if (!isProjectSlugAuthorized(apiToken.projectId, projectSlug)) {
    return c.text("Forbidden", 403);
  }
  const version = c.req.param("version");
  await deleteReleaseForProject(c.env.DB, apiToken.projectId, version, apiToken.createdBy);
  return c.body(null, 204);
});

// ============================================================================
// Dashboard-facing surface (contracts/releases-internal-api.md) — sessionAuth-gated.
// ============================================================================

export const releasesInternalRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

releasesInternalRoutes.use("*", sessionAuth);

// T046 (Phase 8 convergence): "adoption" is defined by spec.md User Story 2 Acceptance Scenario 1
// as a release's "share of RECENT sessions", not a lifetime share — the original implementation
// summed `sessions_total` over every `release_health` row ever written for the project, with no
// time bound at all. No day count is stated anywhere in spec.md/research.md, so this picks one
// explicitly rather than leaving it unbounded: 14 days. Rationale — `release_health` is aggregated
// at daily granularity (data-model.md's `date` column), so a 1-day window would be too sparse for
// low-traffic projects (and unusable for manual/local testing, where "today" may hold the only
// data); this module intentionally introduces no NEW retention window of its own (plan.md's
// Principle IX note — release-health data is small, pre-aggregated, not raw high-volume telemetry),
// so 14 days is chosen as a sensible middle point between the two bounded windows already
// established elsewhere in this codebase for genuinely comparable "how are things going lately"
// figures — logs' 7-day window (specs/004-structured-logs) and traces/uptime's 30-day window
// (specs/003-distributed-tracing, specs/006-uptime-monitoring) — long enough to be stable for a
// normal release cadence, short enough that an old release's lingering trickle of sessions doesn't
// permanently dilute a new release's adoption share.
const ADOPTION_WINDOW_DAYS = 14;

interface HealthRow {
  release_id: string;
  environment: string;
  sessions_total: number;
  sessions_crashed: number;
}

interface UsersRow {
  release_id: string;
  environment: string;
  users_total: number;
  users_crashed: number;
}

async function computeReleaseFigures(
  db: D1Database,
  releaseId: string,
): Promise<{
  perEnvironment: {
    environment: string;
    adoptionPercent: number;
    crashFreeSessionRate: number | null;
    crashFreeUserRate: number | null;
  }[];
  overallAdoption: number | null;
  overallCrashFreeSession: number | null;
  overallCrashFreeUser: number | null;
}> {
  const { results: healthRows } = await db
    .prepare(
      `SELECT release_id, environment, SUM(sessions_total) as sessions_total, SUM(sessions_crashed) as sessions_crashed
       FROM release_health WHERE release_id = ?1 GROUP BY environment`,
    )
    .bind(releaseId)
    .all<HealthRow>();

  const { results: userRows } = await db
    .prepare(
      `SELECT release_id, environment, COUNT(*) as users_total, SUM(crashed) as users_crashed
       FROM release_health_users WHERE release_id = ?1 GROUP BY environment`,
    )
    .bind(releaseId)
    .all<UsersRow>();
  const userMap = new Map((userRows ?? []).map((r) => [r.environment, r]));

  // Adoption is windowed to the last ADOPTION_WINDOW_DAYS days (T046) — a SEPARATE, narrower query
  // from healthRows above, which stays lifetime-scoped for the crash-free rate figures (unaffected
  // by this change; spec.md doesn't describe those as "recent"-windowed).
  const windowStart = `-${ADOPTION_WINDOW_DAYS - 1} days`;
  const { results: recentHealthRows } = await db
    .prepare(
      `SELECT release_id, environment, SUM(sessions_total) as sessions_total, SUM(sessions_crashed) as sessions_crashed
       FROM release_health WHERE release_id = ?1 AND date >= date('now', ?2) GROUP BY environment`,
    )
    .bind(releaseId, windowStart)
    .all<HealthRow>();
  const recentSessionsMap = new Map(
    (recentHealthRows ?? []).map((r) => [r.environment, r.sessions_total]),
  );

  const totalRecentSessionsAllReleases = await db
    .prepare(
      `SELECT SUM(sessions_total) as total FROM release_health
       WHERE project_id = (SELECT project_id FROM releases WHERE id = ?1) AND date >= date('now', ?2)`,
    )
    .bind(releaseId, windowStart)
    .first<{ total: number | null }>();

  const releaseTotalSessions = (healthRows ?? []).reduce((sum, r) => sum + r.sessions_total, 0);
  const releaseRecentSessions = (recentHealthRows ?? []).reduce(
    (sum, r) => sum + r.sessions_total,
    0,
  );
  const overallAdoption = totalRecentSessionsAllReleases?.total
    ? (releaseRecentSessions / totalRecentSessionsAllReleases.total) * 100
    : null;

  const overallCrashed = (healthRows ?? []).reduce((sum, r) => sum + r.sessions_crashed, 0);
  const overallCrashFreeSession = computeCrashFreeRate(releaseTotalSessions, overallCrashed);
  const totalUsers = [...userMap.values()].reduce((sum, r) => sum + r.users_total, 0);
  const crashedUsers = [...userMap.values()].reduce((sum, r) => sum + (r.users_crashed ?? 0), 0);
  const overallCrashFreeUser = computeCrashFreeRate(totalUsers, crashedUsers);

  const perEnvironment = (healthRows ?? []).map((row) => {
    const users = userMap.get(row.environment);
    return {
      environment: row.environment,
      adoptionPercent: totalRecentSessionsAllReleases?.total
        ? ((recentSessionsMap.get(row.environment) ?? 0) / totalRecentSessionsAllReleases.total) *
          100
        : 0,
      crashFreeSessionRate: computeCrashFreeRate(row.sessions_total, row.sessions_crashed),
      crashFreeUserRate: users
        ? computeCrashFreeRate(users.users_total, users.users_crashed ?? 0)
        : null,
    };
  });

  return { perEnvironment, overallAdoption, overallCrashFreeSession, overallCrashFreeUser };
}

interface ReleaseRow2 {
  id: string;
  version: string;
  date_released: string | null;
}

releasesInternalRoutes.get("/", async (c) => {
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.json({ releases: [] });

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, version, date_released FROM releases WHERE project_id = ?1 ORDER BY created_at DESC`,
    )
    .bind(project.id)
    .all<ReleaseRow2>();

  const releases = await Promise.all(
    (results ?? []).map(async (row) => {
      const figures = await computeReleaseFigures(c.env.DB, row.id);
      const deployCount = await c.env.DB
        .prepare(`SELECT COUNT(*) as count FROM deploys WHERE release_id = ?1`)
        .bind(row.id)
        .first<{ count: number }>();
      return {
        id: row.id,
        version: row.version,
        dateReleased: row.date_released,
        adoptionPercent: figures.overallAdoption,
        crashFreeSessionRate: figures.overallCrashFreeSession,
        crashFreeUserRate: figures.overallCrashFreeUser,
        deployCount: deployCount?.count ?? 0,
      };
    }),
  );

  return c.json({ releases });
});

interface CommitRow {
  sha: string;
  message: string | null;
  author: string | null;
}
interface DeployRow {
  environment: string;
  deployed_at: string;
}
interface RegressedIssueRow {
  id: string;
  title: string;
}

releasesInternalRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.text("Not Found", 404);

  const release = await c.env.DB
    .prepare(`SELECT id, version, date_released FROM releases WHERE id = ?1 AND project_id = ?2`)
    .bind(id, project.id)
    .first<ReleaseRow2>();
  if (!release) return c.text("Not Found", 404);

  const figures = await computeReleaseFigures(c.env.DB, id);
  const { results: commits } = await c.env.DB
    .prepare(`SELECT sha, message, author FROM release_commits WHERE release_id = ?1`)
    .bind(id)
    .all<CommitRow>();
  const { results: deploys } = await c.env.DB
    .prepare(
      `SELECT environment, deployed_at FROM deploys WHERE release_id = ?1 ORDER BY deployed_at DESC`,
    )
    .bind(id)
    .all<DeployRow>();
  const { results: regressedIssues } = await c.env.DB
    .prepare(
      `SELECT id, title FROM issues WHERE resolved_release_id = ?1 AND status = 'unresolved'`,
    )
    .bind(id)
    .all<RegressedIssueRow>();

  return c.json({
    id: release.id,
    version: release.version,
    dateReleased: release.date_released,
    environments: figures.perEnvironment,
    commits: (commits ?? []).map((r) => ({ sha: r.sha, message: r.message, author: r.author })),
    deploys: (deploys ?? []).map((r) => ({
      environment: r.environment,
      deployedAt: r.deployed_at,
    })),
    regressedIssues: (regressedIssues ?? []).map((r) => ({ issueId: r.id, title: r.title })),
  });
});

// ============================================================================
// API token management (contracts/releases-internal-api.md) — sessionAuth-gated, mounted under
// /api/internal/projects as a sibling to Module 2's projectsRoutes/githubRoutes.
// ============================================================================

export const apiTokensRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

apiTokensRoutes.use("*", sessionAuth);

apiTokensRoutes.post("/:id/api-tokens", async (c) => {
  const projectId = c.req.param("id");
  const identity = c.get("identity");
  const rawToken = generateRawToken();
  const tokenHash = await hashToken(rawToken, c.env.API_TOKEN_PEPPER);
  const id = crypto.randomUUID();

  await c.env.DB
    .prepare(
      `INSERT INTO api_tokens (id, project_id, token_hash, created_by) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(id, projectId, tokenHash, identity.sub)
    .run();

  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      identity.sub,
      "api_token.generate",
      JSON.stringify({ projectId, tokenId: id }),
    )
    .run();

  return c.json({ id, token: rawToken }, 201);
});

apiTokensRoutes.delete("/:id/api-tokens/:tokenId", async (c) => {
  const tokenId = c.req.param("tokenId");
  const identity = c.get("identity");

  await c.env.DB
    .prepare(
      `UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ?1 AND revoked_at IS NULL`,
    )
    .bind(tokenId)
    .run();

  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, before_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(crypto.randomUUID(), identity.sub, "api_token.revoke", JSON.stringify({ tokenId }))
    .run();

  return c.body(null, 200);
});
