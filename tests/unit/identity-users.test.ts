import { assertEquals, assertNotEquals } from "@std/assert";
import { upsertUser } from "../../worker/modules/identity/users.ts";

// A minimal fake D1Database implementing only the prepare().bind().run()/first() surface
// upsertUser actually calls — this tests upsertUser's own insert-vs-update contract without
// requiring a real SQLite engine. It always treats the first two-arg-plus bind as the
// insert-or-update and any single-arg bind as the row lookup, matching users.ts's own call
// pattern exactly.
interface FakeRow {
  sub: string;
  email: string;
  idp: string;
  role: string;
  created_at: string;
  last_seen_at: string;
}

class FakeStatement {
  #sql: string;
  #rows: Map<string, FakeRow>;
  #params: unknown[] = [];

  constructor(sql: string, rows: Map<string, FakeRow>) {
    this.#sql = sql;
    this.#rows = rows;
  }

  bind(...params: unknown[]) {
    this.#params = params;
    return this;
  }

  run() {
    const [sub, email, idp] = this.#params as [string, string, string];
    const existing = this.#rows.get(sub);
    if (existing) {
      existing.email = email;
      existing.last_seen_at = `updated-${this.#rows.size}-${crypto.randomUUID()}`;
    } else {
      this.#rows.set(sub, {
        sub,
        email,
        idp,
        role: "member",
        created_at: "created-once",
        last_seen_at: "created-once",
      });
    }
    return Promise.resolve({ success: true });
  }

  first<T>() {
    const [sub] = this.#params as [string];
    const row = this.#rows.get(sub);
    if (!row) return Promise.resolve(null as T | null);
    return Promise.resolve({ sub: row.sub, email: row.email, role: row.role } as T);
  }

  toString() {
    return this.#sql;
  }
}

class FakeD1 {
  rows = new Map<string, FakeRow>();
  prepare(sql: string) {
    return new FakeStatement(sql, this.rows);
  }
}

Deno.test("upsertUser creates a new user with default role on first login", async () => {
  const db = new FakeD1();
  const result = await upsertUser(
    db as unknown as D1Database,
    { sub: "user-1", email: "a@example.com", idp: "cloudflare-access" },
  );
  assertEquals(result, { sub: "user-1", email: "a@example.com", role: "member" });
  assertEquals(db.rows.get("user-1")?.created_at, "created-once");
});

Deno.test("upsertUser updates email and last_seen_at on a returning login, preserving created_at/role", async () => {
  const db = new FakeD1();
  await upsertUser(db as unknown as D1Database, {
    sub: "user-1",
    email: "old@example.com",
    idp: "cloudflare-access",
  });
  const firstSeenAt = db.rows.get("user-1")!.last_seen_at;

  const result = await upsertUser(db as unknown as D1Database, {
    sub: "user-1",
    email: "new@example.com",
    idp: "cloudflare-access",
  });

  assertEquals(result.email, "new@example.com");
  assertEquals(result.role, "member");
  assertEquals(db.rows.get("user-1")?.created_at, "created-once");
  assertNotEquals(db.rows.get("user-1")?.last_seen_at, firstSeenAt);
});
