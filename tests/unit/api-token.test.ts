import { assertEquals, assertNotEquals } from "@std/assert";
import { generateRawToken, hashToken, verifyApiToken } from "../../worker/auth/api-token.ts";

const TEST_PEPPER = "unit-test-pepper-never-deployed";

interface FakeApiTokenRow {
  token_hash: string;
  id: string;
  project_id: string;
  created_by: string;
  revoked_at: string | null;
}

class FakeApiTokenD1 {
  #rows: FakeApiTokenRow[];
  constructor(rows: FakeApiTokenRow[]) {
    this.#rows = rows;
  }
  prepare = (_sql: string) => ({
    bind: (...args: unknown[]) => ({
      // Mirrors the real query's `WHERE token_hash = ?1 OR token_hash = ?2` — matches a row
      // whose token_hash equals EITHER bound candidate hash.
      first: () =>
        Promise.resolve(
          this.#rows.find((r) => args.includes(r.token_hash)) ?? null,
        ),
    }),
  });
}

// Plain SHA-256, no pepper — reimplemented here (not imported) to simulate a token row created
// under the OLD scheme, independent of whatever legacySha256Hex does internally.
async function legacyPlainSha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("generateRawToken produces distinct, sufficiently long values", () => {
  const a = generateRawToken();
  const b = generateRawToken();
  assertNotEquals(a, b);
  assertEquals(a.length, 64); // 32 bytes, hex-encoded
});

Deno.test("a generated token's HMAC hash verifies correctly against the stored hash", async () => {
  const raw = generateRawToken();
  const hash = await hashToken(raw, TEST_PEPPER);
  const db = new FakeApiTokenD1([
    { token_hash: hash, id: "t1", project_id: "demo", created_by: "user1", revoked_at: null },
  ]);
  const identity = await verifyApiToken(db as unknown as D1Database, raw, TEST_PEPPER);
  assertEquals(identity, { tokenId: "t1", projectId: "demo", createdBy: "user1" });
});

Deno.test("a wrong/tampered token fails verification", async () => {
  const raw = generateRawToken();
  const hash = await hashToken(raw, TEST_PEPPER);
  const db = new FakeApiTokenD1([
    { token_hash: hash, id: "t1", project_id: "demo", created_by: "user1", revoked_at: null },
  ]);
  const identity = await verifyApiToken(
    db as unknown as D1Database,
    generateRawToken(),
    TEST_PEPPER,
  );
  assertEquals(identity, null);
});

Deno.test("a revoked token's hash fails verification even if otherwise correct", async () => {
  const raw = generateRawToken();
  const hash = await hashToken(raw, TEST_PEPPER);
  const db = new FakeApiTokenD1([
    {
      token_hash: hash,
      id: "t1",
      project_id: "demo",
      created_by: "user1",
      revoked_at: "2026-08-22 00:00:00",
    },
  ]);
  const identity = await verifyApiToken(db as unknown as D1Database, raw, TEST_PEPPER);
  assertEquals(identity, null);
});

// (a) Backward compatibility: a row created under the OLD plain-SHA256 scheme (simulating a token
// issued before T047 shipped) must keep authenticating via the legacy-hash branch, forever, with
// no migration.
Deno.test("a legacy plain-SHA256 token row still authenticates via verifyApiToken", async () => {
  const raw = generateRawToken();
  const legacyHash = await legacyPlainSha256Hex(raw);
  const db = new FakeApiTokenD1([
    {
      token_hash: legacyHash,
      id: "legacy-1",
      project_id: "demo",
      created_by: "user1",
      revoked_at: null,
    },
  ]);
  const identity = await verifyApiToken(db as unknown as D1Database, raw, TEST_PEPPER);
  assertEquals(identity, { tokenId: "legacy-1", projectId: "demo", createdBy: "user1" });
});

// (b) The pepper is actually applied: a newly created token's stored hash must NOT equal plain
// SHA-256(rawToken) — proving hashToken isn't secretly falling back to the legacy scheme.
Deno.test("a new token's HMAC hash differs from plain SHA-256 of the same raw token", async () => {
  const raw = generateRawToken();
  const hmacHash = await hashToken(raw, TEST_PEPPER);
  const plainHash = await legacyPlainSha256Hex(raw);
  assertNotEquals(hmacHash, plainHash);
});

// (c) An invalid/unknown token still fails closed, even when the store holds both legacy- and
// HMAC-scheme rows.
Deno.test("an unknown token fails closed against a store holding both legacy and HMAC rows", async () => {
  const legacyRaw = generateRawToken();
  const legacyHash = await legacyPlainSha256Hex(legacyRaw);
  const hmacRaw = generateRawToken();
  const hmacHash = await hashToken(hmacRaw, TEST_PEPPER);
  const db = new FakeApiTokenD1([
    {
      token_hash: legacyHash,
      id: "legacy-1",
      project_id: "demo",
      created_by: "user1",
      revoked_at: null,
    },
    {
      token_hash: hmacHash,
      id: "hmac-1",
      project_id: "demo",
      created_by: "user1",
      revoked_at: null,
    },
  ]);
  const identity = await verifyApiToken(
    db as unknown as D1Database,
    generateRawToken(),
    TEST_PEPPER,
  );
  assertEquals(identity, null);
});
