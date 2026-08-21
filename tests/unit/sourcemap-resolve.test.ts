import { assertEquals } from "@std/assert";
import { resolveStackTrace } from "../../worker/modules/ingest/sourcemap.ts";
import type { StackFrame } from "../../worker/modules/ingest/types.ts";

// A real, hand-constructed Source Map v3 fixture (research.md §6's spike requirement) —
// mappings "AAAAA;GACE" decodes to two segments:
//   generated (line 1, col 0) -> sources[0]="app.js", original (line 1, col 0), names[0]="render"
//   generated (line 2, col 3) -> sources[0]="app.js", original (line 2, col 2), no name
const REAL_SOURCE_MAP = {
  version: 3,
  sources: ["app.js"],
  names: ["render"],
  mappings: "AAAAA;GACE",
};

class FakeD1 implements Partial<D1Database> {
  #row: Record<string, unknown> | null;
  constructor(row: Record<string, unknown> | null) {
    this.#row = row;
  }
  prepare() {
    const row = this.#row;
    const stmt: Partial<D1PreparedStatement> = {
      bind: () => stmt as D1PreparedStatement,
      first: <T>() => Promise.resolve(row as T | null),
    };
    return stmt as D1PreparedStatement;
  }
}

class FakeR2 implements Partial<R2Bucket> {
  #objects: Map<string, unknown>;
  constructor(objects: Map<string, unknown>) {
    this.#objects = objects;
  }
  get(key: string) {
    if (!this.#objects.has(key)) return Promise.resolve(null);
    const value = this.#objects.get(key);
    return Promise.resolve({ json: () => Promise.resolve(value) } as unknown as R2ObjectBody);
  }
}

function minifiedFrame(overrides: Partial<StackFrame> = {}): StackFrame {
  return { filename: "app.min.js", function: "n", lineno: 1, colno: 0, in_app: true, ...overrides };
}

Deno.test("resolveStackTrace resolves a minified position to the original source/line/column/name", async () => {
  const db = new FakeD1({ r2_object_key: "demo/1.0.0/abc" }) as unknown as D1Database;
  const r2 = new FakeR2(new Map([["demo/1.0.0/abc", REAL_SOURCE_MAP]])) as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(db, r2, "demo", "1.0.0", [minifiedFrame()]);

  assertEquals(resolved.resolved, true);
  assertEquals(resolved.filename, "app.js");
  assertEquals(resolved.lineno, 1);
  assertEquals(resolved.colno, 0);
  assertEquals(resolved.function, "render");
});

Deno.test("resolveStackTrace resolves a second line's position without a name", async () => {
  const db = new FakeD1({ r2_object_key: "demo/1.0.0/abc" }) as unknown as D1Database;
  const r2 = new FakeR2(new Map([["demo/1.0.0/abc", REAL_SOURCE_MAP]])) as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(
    db,
    r2,
    "demo",
    "1.0.0",
    [minifiedFrame({ function: "t", lineno: 2, colno: 3 })],
  );

  assertEquals(resolved.resolved, true);
  assertEquals(resolved.filename, "app.js");
  assertEquals(resolved.lineno, 2);
  assertEquals(resolved.colno, 2);
});

Deno.test("resolveStackTrace returns frames unresolved when the event has no release", async () => {
  const db = new FakeD1(null) as unknown as D1Database;
  const r2 = new FakeR2(new Map()) as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(db, r2, "demo", undefined, [minifiedFrame()]);

  assertEquals(resolved.resolved, false);
  assertEquals(resolved.filename, "app.min.js");
});

Deno.test("resolveStackTrace returns frames unresolved when no map is uploaded for this release/path", async () => {
  const db = new FakeD1(null) as unknown as D1Database;
  const r2 = new FakeR2(new Map()) as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(db, r2, "demo", "1.0.0", [minifiedFrame()]);

  assertEquals(resolved.resolved, false);
  assertEquals(resolved.filename, "app.min.js");
});

Deno.test("resolveStackTrace leaves frames with no line/column info unresolved rather than throwing", async () => {
  const db = new FakeD1({ r2_object_key: "demo/1.0.0/abc" }) as unknown as D1Database;
  const r2 = new FakeR2(new Map([["demo/1.0.0/abc", REAL_SOURCE_MAP]])) as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(
    db,
    r2,
    "demo",
    "1.0.0",
    [minifiedFrame({ lineno: undefined, colno: undefined })],
  );

  assertEquals(resolved.resolved, false);
});
