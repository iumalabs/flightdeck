import { assertEquals, assertNotEquals } from "@std/assert";
import { generateRawToken, hashToken, verifyApiToken } from "../../worker/auth/api-token.ts";

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
      first: () => Promise.resolve(this.#rows.find((r) => r.token_hash === args[0]) ?? null),
    }),
  });
}

Deno.test("generateRawToken produces distinct, sufficiently long values", () => {
  const a = generateRawToken();
  const b = generateRawToken();
  assertNotEquals(a, b);
  assertEquals(a.length, 64); // 32 bytes, hex-encoded
});

Deno.test("a generated token's hash verifies correctly against the stored hash", async () => {
  const raw = generateRawToken();
  const hash = await hashToken(raw);
  const db = new FakeApiTokenD1([
    { token_hash: hash, id: "t1", project_id: "demo", created_by: "user1", revoked_at: null },
  ]);
  const identity = await verifyApiToken(db as unknown as D1Database, raw);
  assertEquals(identity, { tokenId: "t1", projectId: "demo", createdBy: "user1" });
});

Deno.test("a wrong/tampered token fails verification", async () => {
  const raw = generateRawToken();
  const hash = await hashToken(raw);
  const db = new FakeApiTokenD1([
    { token_hash: hash, id: "t1", project_id: "demo", created_by: "user1", revoked_at: null },
  ]);
  const identity = await verifyApiToken(db as unknown as D1Database, generateRawToken());
  assertEquals(identity, null);
});

Deno.test("a revoked token's hash fails verification even if otherwise correct", async () => {
  const raw = generateRawToken();
  const hash = await hashToken(raw);
  const db = new FakeApiTokenD1([
    {
      token_hash: hash,
      id: "t1",
      project_id: "demo",
      created_by: "user1",
      revoked_at: "2026-08-22 00:00:00",
    },
  ]);
  const identity = await verifyApiToken(db as unknown as D1Database, raw);
  assertEquals(identity, null);
});
