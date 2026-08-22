import type { MiddlewareHandler } from "hono";

// Project-scoped Bearer API tokens (research.md §4, specs/005-releases) — an extension of the
// control-plane trust surface's authorization for non-browser CI/CD clients (sentry-cli), NOT a
// third trust surface and NOT the DSN-ingest mechanism. Mirrors worker/auth/session.ts's
// fail-closed posture exactly, just carried as `Authorization: Bearer <token>` instead of a
// cookie.

export interface ApiTokenIdentity {
  tokenId: string;
  projectId: string;
  createdBy: string;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A cryptographically random 32-byte value, hex-encoded — shown to the generating user exactly
// once (data-model.md's API Token section); FlightDeck stores only its hash.
export function generateRawToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hashToken(rawToken: string): Promise<string> {
  return sha256Hex(rawToken);
}

interface ApiTokenRow {
  id: string;
  project_id: string;
  created_by: string;
  revoked_at: string | null;
}

// Fails closed (null) on a missing row or a revoked one — constitution Principle III's posture,
// applied to this control-plane-adjacent mechanism (research.md §4).
export async function verifyApiToken(
  db: D1Database,
  rawToken: string,
): Promise<ApiTokenIdentity | null> {
  const tokenHash = await hashToken(rawToken);
  const row = await db
    .prepare(`SELECT id, project_id, created_by, revoked_at FROM api_tokens WHERE token_hash = ?1`)
    .bind(tokenHash)
    .first<ApiTokenRow>();
  if (!row || row.revoked_at) return null;
  return { tokenId: row.id, projectId: row.project_id, createdBy: row.created_by };
}

interface ApiTokenEnv {
  DB: D1Database;
}

export const apiTokenAuth: MiddlewareHandler<
  { Bindings: ApiTokenEnv; Variables: { apiToken: ApiTokenIdentity } }
> = async (c, next) => {
  const header = c.req.header("Authorization");
  const rawToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!rawToken) {
    return c.text("Forbidden", 403);
  }

  const identity = await verifyApiToken(c.env.DB, rawToken);
  if (!identity) {
    return c.text("Forbidden", 403);
  }

  c.set("apiToken", identity);
  await next();
};
