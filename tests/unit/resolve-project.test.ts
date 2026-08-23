import { assertEquals, assertStrictEquals } from "@std/assert";
import { resolveRequestedProject } from "../../worker/modules/projects/resolve.ts";

class FakeD1 {
  projects: { id: string; name: string; created_at: string }[] = [];

  #firstFor<T>(sql: string, args: unknown[]): Promise<T | null> {
    if (sql.includes("WHERE id = ?1")) {
      const id = args[0] as string;
      const row = this.projects.find((p) => p.id === id);
      return Promise.resolve((row ? { id: row.id, name: row.name } : null) as T | null);
    }
    if (sql.includes("ORDER BY created_at ASC")) {
      const sorted = [...this.projects].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const first = sorted[0];
      return Promise.resolve((first ? { id: first.id, name: first.name } : null) as T | null);
    }
    return Promise.resolve(null);
  }

  prepare = (sql: string) => {
    return {
      first: <T>(): Promise<T | null> => this.#firstFor<T>(sql, []),
      bind: (...args: unknown[]) => ({
        first: <T>(): Promise<T | null> => this.#firstFor<T>(sql, args),
      }),
    };
  };
}

Deno.test("resolveRequestedProject returns the requested project when it resolves", async () => {
  const db = new FakeD1();
  db.projects = [
    { id: "demo", name: "Demo", created_at: "2026-01-01" },
    { id: "typestreak", name: "TypeStreak", created_at: "2026-02-01" },
  ];
  const result = await resolveRequestedProject(db as unknown as D1Database, "typestreak");
  assertEquals(result, { id: "typestreak", name: "TypeStreak" });
});

Deno.test("resolveRequestedProject falls back to the first project (by created_at) when omitted", async () => {
  const db = new FakeD1();
  db.projects = [
    { id: "demo", name: "Demo", created_at: "2026-01-01" },
    { id: "typestreak", name: "TypeStreak", created_at: "2026-02-01" },
  ];
  const result = await resolveRequestedProject(db as unknown as D1Database, null);
  assertEquals(result, { id: "demo", name: "Demo" });
});

Deno.test("resolveRequestedProject falls back to the first project when the requested id doesn't resolve", async () => {
  const db = new FakeD1();
  db.projects = [
    { id: "demo", name: "Demo", created_at: "2026-01-01" },
    { id: "typestreak", name: "TypeStreak", created_at: "2026-02-01" },
  ];
  const result = await resolveRequestedProject(db as unknown as D1Database, "does-not-exist");
  assertEquals(result, { id: "demo", name: "Demo" });
});

Deno.test("resolveRequestedProject returns null when no projects exist at all", async () => {
  const db = new FakeD1();
  const result = await resolveRequestedProject(db as unknown as D1Database, null);
  assertStrictEquals(result, null);
});
