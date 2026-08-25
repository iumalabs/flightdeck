import { Hono } from "hono";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";
import { extractMatchingLines } from "./extract.ts";
import {
  createExportToken,
  getOrCreateProjectBucket,
  revokeExportToken,
  revokePreviousExportToken,
  snapshotProjectLogs,
} from "./r2-provision.ts";
import type { LiveTail } from "../../durable-objects/live-tail.ts";
import { resolveRequestedProject } from "../projects/resolve.ts";

interface Env {
  DB: D1Database;
  LOGS: R2Bucket;
  LIVE_TAIL: DurableObjectNamespace<LiveTail>;
  CF_ACCOUNT_ID: string;
  CLOUDFLARE_R2_ADMIN_TOKEN: string;
}

const PAGE_SIZE = 50;

// FTS5's MATCH argument has its OWN query syntax (hyphens, quotes, AND/OR/NOT, column filters...)
// — a free-text user query MUST be quoted as a literal FTS5 string, not passed raw, or content
// like "zzz-nonexistent-zzz" gets parsed as FTS5 operators (a hyphenated word is NOT-syntax) and
// throws a SQLITE_ERROR instead of just finding no matches (confirmed live against a real
// wrangler dev during implementation). Doubling any literal `"` escapes it inside the quoted
// string, per FTS5's own quoting rule.
export function toFts5MatchLiteral(q: string): string {
  return `"${q.replace(/"/g, '""')}"`;
}

interface CandidateBatch {
  id: string;
  r2_object_key: string;
}

async function fetchCandidateBatches(
  db: D1Database,
  projectId: string,
  q?: string,
  level?: string,
  from?: string,
  to?: string,
): Promise<CandidateBatch[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  params.push(projectId);
  conditions.push(`lb.project_id = ?${params.length}`);
  if (level) {
    params.push(`%${level}%`);
    conditions.push(`lb.levels_present LIKE ?${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`lb.ended_at >= ?${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`lb.started_at <= ?${params.length}`);
  }

  let sql: string;
  if (q) {
    params.push(toFts5MatchLiteral(q));
    const qParam = params.length;
    sql = `SELECT lb.id, lb.r2_object_key FROM log_batches_fts fts
      JOIN log_batches lb ON lb.id = fts.batch_id
      WHERE log_batches_fts MATCH ?${qParam} AND ${conditions.join(" AND ")}
      ORDER BY bm25(log_batches_fts) LIMIT 200`;
  } else {
    sql = `SELECT lb.id, lb.r2_object_key FROM log_batches lb
      WHERE ${conditions.join(" AND ")}
      ORDER BY lb.started_at DESC LIMIT 200`;
  }

  const { results } = await db.prepare(sql).bind(...params).all<CandidateBatch>();
  return results ?? [];
}

export const logsRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

logsRoutes.use("*", sessionAuth);

// contracts/logs-internal-api.md's GET /api/internal/logs/search — bounded, offset-cursor
// pagination over lines extracted from candidate batches at read time (research.md §5).
logsRoutes.get("/search", async (c) => {
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.json({ lines: [], nextCursor: null });

  const q = c.req.query("q");
  const level = c.req.query("level");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const offset = Math.max(0, parseInt(c.req.query("cursor") ?? "0", 10) || 0);

  const candidates = await fetchCandidateBatches(c.env.DB, project.id, q, level, from, to);
  const allLines = (
    await Promise.all(
      candidates.map((batch) =>
        extractMatchingLines(c.env.LOGS, batch.r2_object_key, { q, level, from, to })
      ),
    )
  ).flat();
  allLines.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const page = allLines.slice(offset, offset + PAGE_SIZE);
  const nextCursor = offset + PAGE_SIZE < allLines.length ? String(offset + PAGE_SIZE) : null;

  return c.json({
    lines: page.map((line) => ({
      timestamp: line.timestamp,
      level: line.level,
      body: line.body,
      attributes: line.attributes,
      traceId: line.traceId,
    })),
    nextCursor,
  });
});

// contracts/logs-internal-api.md's GET /api/internal/logs/live-tail — the HTTP upgrade request
// itself is sessionAuth-gated (above); the DO does not re-authenticate each message.
logsRoutes.get("/live-tail", async (c) => {
  const project = await resolveRequestedProject(c.env.DB, c.req.query("project") ?? null);
  if (!project) return c.text("Not Found", 404);

  const id = c.env.LIVE_TAIL.idFromName(project.id);
  const stub = c.env.LIVE_TAIL.get(id);
  return stub.fetch(c.req.raw);
});

// contracts/logs-internal-api.md's export-credential routes — mounted separately (under
// /api/internal/projects) in worker/index.ts, matching Module 2's githubRoutes pattern.
export const logExportRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

logExportRoutes.use("*", sessionAuth);

interface BatchKeyRow {
  r2_object_key: string;
}

logExportRoutes.post("/:id/log-export/credential", async (c) => {
  const projectId = c.req.param("id");
  const bucketName = await getOrCreateProjectBucket(
    c.env.CF_ACCOUNT_ID,
    c.env.CLOUDFLARE_R2_ADMIN_TOKEN,
    projectId,
  );

  // Revoke any token already issued for this project BEFORE minting a new one, so a
  // re-provision never orphans a live R2 API token (issue #56) — mirrors the DELETE handler's
  // SELECT-then-revoke pattern below.
  await revokePreviousExportToken(
    c.env.DB,
    c.env.CF_ACCOUNT_ID,
    c.env.CLOUDFLARE_R2_ADMIN_TOKEN,
    projectId,
  );

  const credential = await createExportToken(
    c.env.CF_ACCOUNT_ID,
    c.env.CLOUDFLARE_R2_ADMIN_TOKEN,
    bucketName,
  );
  if (!credential) {
    return c.text("Failed to provision export access", 502);
  }

  const { results } = await c.env.DB
    .prepare(`SELECT r2_object_key FROM log_batches WHERE project_id = ?1`)
    .bind(projectId)
    .all<BatchKeyRow>();
  await snapshotProjectLogs(
    c.env.CF_ACCOUNT_ID,
    c.env.CLOUDFLARE_R2_ADMIN_TOKEN,
    c.env.LOGS,
    bucketName,
    results ?? [],
  );

  // Tracks the (non-secret) token id for later revocation — data-model.md's Export Credential
  // section. A re-provision replaces any prior record for this project.
  await c.env.DB
    .prepare(
      `INSERT INTO log_export_tokens (project_id, token_id, bucket_name, created_at)
       VALUES (?1, ?2, ?3, datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET token_id = ?2, bucket_name = ?3, created_at = datetime('now')`,
    )
    .bind(projectId, credential.tokenId, bucketName)
    .run();

  // Constitution Principle X — export provisioning is an admin mutation. The token secret itself
  // is never persisted, per data-model.md's Export Credential section — only that one was issued.
  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, after_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      identity.sub,
      "log_export.provision",
      JSON.stringify({ projectId, bucket: bucketName, tokenId: credential.tokenId }),
    )
    .run();

  return c.json(
    {
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
      endpoint: credential.endpoint,
      bucket: credential.bucket,
    },
    201,
  );
});

interface ExportTokenRow {
  token_id: string;
}

logExportRoutes.delete("/:id/log-export/credential", async (c) => {
  const projectId = c.req.param("id");

  // Idempotent — revoking when nothing is provisioned is a 200, not a 404 (Module 2's
  // GitHub-disconnect precedent, contracts/logs-internal-api.md).
  const existing = await c.env.DB
    .prepare(`SELECT token_id FROM log_export_tokens WHERE project_id = ?1`)
    .bind(projectId)
    .first<ExportTokenRow>();

  if (existing) {
    await revokeExportToken(
      c.env.CF_ACCOUNT_ID,
      c.env.CLOUDFLARE_R2_ADMIN_TOKEN,
      existing.token_id,
    );
    await c.env.DB.prepare(`DELETE FROM log_export_tokens WHERE project_id = ?1`).bind(projectId)
      .run();
  }

  const identity = c.get("identity");
  await c.env.DB
    .prepare(`INSERT INTO audit_log (id, actor_sub, action, before_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(
      crypto.randomUUID(),
      identity.sub,
      "log_export.revoke",
      JSON.stringify({ projectId, tokenId: existing?.token_id ?? null }),
    )
    .run();

  return c.text("", 200);
});
