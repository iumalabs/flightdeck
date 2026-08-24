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

// The OLD hashing scheme — plain SHA-256, no secret involved. Kept (not deleted) so already-issued
// tokens, whose `token_hash` row was computed this way, keep authenticating forever with zero
// migration/reissuance (T047, specs/005-releases Phase 8 convergence). `verifyApiToken` checks a
// presented token against BOTH this and the new HMAC scheme below.
async function legacySha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A cryptographically random 32-byte value, hex-encoded — shown to the generating user exactly
// once (data-model.md's API Token section); FlightDeck stores only its hash.
export function generateRawToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// HMAC-SHA256(key = API_TOKEN_PEPPER, message = rawToken), hex-encoded — the current hashing
// scheme (T047). Deliberately NOT a per-token salt: this lookup-by-hash design (verifyApiToken
// below queries `WHERE token_hash = ?`) needs to compute the same hash a stored row was created
// with, before it knows which row it's looking for — a true per-token salt would require the token
// itself to carry a public row id, which would invalidate every already-issued token. A shared
// server-side pepper (a Worker secret, never stored in D1) instead closes the real threat model:
// an attacker who steals a D1 dump alone (not the Worker's secrets) cannot brute-force tokens via
// precomputed/rainbow-table hashes, since the pepper never leaves the Worker.
export async function hashToken(rawToken: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawToken));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface ApiTokenRow {
  id: string;
  project_id: string;
  created_by: string;
  revoked_at: string | null;
}

// Fails closed (null) on a missing row or a revoked one — constitution Principle III's posture,
// applied to this control-plane-adjacent mechanism (research.md §4). Computes BOTH the new
// HMAC-with-pepper hash and the legacy plain-SHA256 hash from the presented raw token and matches
// against either — a newly-created token (stored via `hashToken` in the release-creation route)
// only ever matches the HMAC branch, while a pre-existing token (stored before T047 shipped) keeps
// matching the legacy branch, with no DB migration needed (schema-free by design).
export async function verifyApiToken(
  db: D1Database,
  rawToken: string,
  pepper: string,
): Promise<ApiTokenIdentity | null> {
  const hmacHash = await hashToken(rawToken, pepper);
  const legacyHash = await legacySha256Hex(rawToken);
  const row = await db
    .prepare(
      `SELECT id, project_id, created_by, revoked_at FROM api_tokens WHERE token_hash = ?1 OR token_hash = ?2`,
    )
    .bind(hmacHash, legacyHash)
    .first<ApiTokenRow>();
  if (!row || row.revoked_at) return null;
  return { tokenId: row.id, projectId: row.project_id, createdBy: row.created_by };
}

interface ApiTokenEnv {
  DB: D1Database;
  API_TOKEN_PEPPER: string;
}

export const apiTokenAuth: MiddlewareHandler<
  { Bindings: ApiTokenEnv; Variables: { apiToken: ApiTokenIdentity } }
> = async (c, next) => {
  const header = c.req.header("Authorization");
  const rawToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!rawToken) {
    return c.text("Forbidden", 403);
  }

  const identity = await verifyApiToken(c.env.DB, rawToken, c.env.API_TOKEN_PEPPER);
  if (!identity) {
    return c.text("Forbidden", 403);
  }

  c.set("apiToken", identity);
  await next();
};
