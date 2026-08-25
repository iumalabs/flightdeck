// S3-compatible export access provisioning — research.md §8 (specs/004-structured-logs), resolved
// against Cloudflare's real REST API (bucket management, account-owned API tokens) since neither
// FlightDeck's own docs nor develop.sentry.dev cover this — a genuinely new kind of research for
// this project, verified against developers.cloudflare.com directly, not assumed.

import { AwsClient } from "aws4fetch";

// Kept local (not imported from routes.ts) to avoid a circular import between this module and
// routes.ts, which imports from here.
export interface LogBatchRow {
  r2_object_key: string;
}

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function authHeaders(adminToken: string): Record<string, string> {
  return { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };
}

export function projectBucketName(projectId: string): string {
  return `flightdeck-export-${projectId}`;
}

// Idempotent — a 409/"already exists" response from Cloudflare is treated as success, not an
// error, since this may be called again for a project that already has its export bucket.
export async function getOrCreateProjectBucket(
  accountId: string,
  adminToken: string,
  projectId: string,
): Promise<string> {
  const bucketName = projectBucketName(projectId);
  const existing = await fetch(
    `${CLOUDFLARE_API_BASE}/accounts/${accountId}/r2/buckets/${bucketName}`,
    { headers: authHeaders(adminToken) },
  );
  if (existing.ok) return bucketName;

  await fetch(`${CLOUDFLARE_API_BASE}/accounts/${accountId}/r2/buckets`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ name: bucketName }),
  });
  return bucketName;
}

interface PermissionGroup {
  id: string;
  name: string;
}

async function findPermissionGroupId(
  accountId: string,
  adminToken: string,
  name: string,
): Promise<string | null> {
  const response = await fetch(
    `${CLOUDFLARE_API_BASE}/accounts/${accountId}/tokens/permission_groups`,
    { headers: authHeaders(adminToken) },
  );
  if (!response.ok) return null;
  const body = await response.json() as { result?: PermissionGroup[] };
  return body.result?.find((group) => group.name === name)?.id ?? null;
}

interface CreatedToken {
  id: string;
  value: string;
}

async function createBucketScopedToken(
  accountId: string,
  adminToken: string,
  bucketName: string,
  permissionGroupName: string,
): Promise<CreatedToken | null> {
  const permissionGroupId = await findPermissionGroupId(accountId, adminToken, permissionGroupName);
  if (!permissionGroupId) return null;

  const response = await fetch(`${CLOUDFLARE_API_BASE}/accounts/${accountId}/tokens`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      name: `flightdeck-export-${bucketName}-${crypto.randomUUID().slice(0, 8)}`,
      policies: [
        {
          effect: "allow",
          resources: {
            [`com.cloudflare.edge.r2.bucket.${accountId}_default_${bucketName}`]: "*",
          },
          permission_groups: [{ id: permissionGroupId, name: permissionGroupName }],
        },
      ],
    }),
  });
  if (!response.ok) return null;

  const body = await response.json() as { result?: { id: string; value: string } };
  if (!body.result) return null;
  return { id: body.result.id, value: body.result.value };
}

export interface ExportCredential {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
  tokenId: string;
}

// Access Key ID = the token's own id; Secret Access Key = the SHA-256 hash of the token's value
// (Cloudflare's own documented mapping from an R2-scoped API token to S3-compatible credentials —
// developers.cloudflare.com/r2/api/tokens/).
async function toS3Credential(token: CreatedToken): Promise<{ secretAccessKey: string }> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.value));
  const secretAccessKey = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { secretAccessKey };
}

export async function createExportToken(
  accountId: string,
  adminToken: string,
  bucketName: string,
): Promise<ExportCredential | null> {
  const token = await createBucketScopedToken(
    accountId,
    adminToken,
    bucketName,
    "Workers R2 Storage Bucket Item Read",
  );
  if (!token) return null;
  const { secretAccessKey } = await toS3Credential(token);
  return {
    accessKeyId: token.id,
    secretAccessKey,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucket: bucketName,
    tokenId: token.id,
  };
}

export async function revokeExportToken(
  accountId: string,
  adminToken: string,
  tokenId: string,
): Promise<boolean> {
  const response = await fetch(`${CLOUDFLARE_API_BASE}/accounts/${accountId}/tokens/${tokenId}`, {
    method: "DELETE",
    headers: authHeaders(adminToken),
  });
  return response.ok;
}

interface ExportTokenRow {
  token_id: string;
}

// Revokes the project's previously-issued export token (if any) BEFORE the caller mints and
// stores a new one. Without this, POST /:id/log-export/credential's `ON CONFLICT(project_id) DO
// UPDATE` on log_export_tokens silently overwrites the old token_id, leaking it as a live,
// untracked R2 API token in the Cloudflare account (issue #56). Mirrors the DELETE handler's own
// SELECT-then-revoke pattern in routes.ts.
//
// A failed revoke of the OLD token must never block issuing the NEW one — surfaced via
// console.error instead, matching log-consumer.ts's "log and continue" precedent for
// best-effort cleanup that shouldn't fail the request it's part of.
export async function revokePreviousExportToken(
  db: D1Database,
  accountId: string,
  adminToken: string,
  projectId: string,
): Promise<void> {
  const existing = await db
    .prepare(`SELECT token_id FROM log_export_tokens WHERE project_id = ?1`)
    .bind(projectId)
    .first<ExportTokenRow>();
  if (!existing) return;

  try {
    const revoked = await revokeExportToken(accountId, adminToken, existing.token_id);
    if (!revoked) {
      console.error(
        `log-export: failed to revoke previous token ${existing.token_id} for project ${projectId}`,
      );
    }
  } catch (err) {
    console.error(
      `log-export: error revoking previous token ${existing.token_id} for project ${projectId}`,
      err,
    );
  }
}

// Bounded, one-time snapshot copy (research.md §8's correction) — NOT an ongoing live sync. Mints
// a short-lived, FlightDeck-owned write-scoped token for the destination bucket, reads each known
// batch straight off the shared LOGS binding (no S3 API needed for that half — it's a normal
// R2Bucket the Worker already has), and PUTs it into the export bucket via aws4fetch/SigV4 (the
// only path in this module that actually needs request signing, confined to this one, P3,
// low-frequency operation).
export async function snapshotProjectLogs(
  accountId: string,
  adminToken: string,
  sourceBucket: R2Bucket,
  destinationBucketName: string,
  batches: LogBatchRow[],
): Promise<number> {
  const writeToken = await createBucketScopedToken(
    accountId,
    adminToken,
    destinationBucketName,
    "Workers R2 Storage Bucket Item Write",
  );
  if (!writeToken) return 0;
  const { secretAccessKey } = await toS3Credential(writeToken);
  const client = new AwsClient({
    accessKeyId: writeToken.id,
    secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${destinationBucketName}`;

  let copied = 0;
  for (const batch of batches) {
    const object = await sourceBucket.get(batch.r2_object_key);
    if (!object) continue;
    const body = await object.arrayBuffer();
    const response = await client.fetch(`${endpoint}/${batch.r2_object_key}`, {
      method: "PUT",
      body,
    });
    if (response.ok) copied += 1;
  }

  await revokeExportToken(accountId, adminToken, writeToken.id);
  return copied;
}
