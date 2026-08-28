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

// Backs loadTracer()'s single SELECT ... WHERE project_id/version (issue #142's fetch-then-match
// query) — takes the full set of source_maps rows for a (project, release) pair; loadTracer()
// itself does the pattern matching in code.
class FakeD1 implements Partial<D1Database> {
  #rows: Record<string, unknown>[];
  constructor(rows: Record<string, unknown>[] | Record<string, unknown> | null) {
    this.#rows = rows == null ? [] : Array.isArray(rows) ? rows : [rows];
  }
  prepare() {
    const rows = this.#rows;
    const stmt: Partial<D1PreparedStatement> = {
      bind: () => stmt as D1PreparedStatement,
      first: <T>() => Promise.resolve((rows[0] as T | undefined) ?? null),
      all: <T>() => Promise.resolve({ results: rows as T[] } as unknown as D1Result<T>),
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

// issue #125's non-JSON repro: `object.json()` rejects rather than resolving to a value.
class FakeR2NonJson implements Partial<R2Bucket> {
  get(_key: string) {
    return Promise.resolve({
      json: () =>
        Promise.reject(new SyntaxError("Unexpected token 'n', \"not json\" is not valid JSON")),
    } as unknown as R2ObjectBody);
  }
}

// Valid JSON, but not a structurally valid source map — throws inside `new TraceMap(...)` itself
// rather than during the JSON parse.
class FakeR2InvalidMap implements Partial<R2Bucket> {
  get(_key: string) {
    return Promise.resolve(
      { json: () => Promise.resolve({ not: "a source map" }) } as unknown as R2ObjectBody,
    );
  }
}

function minifiedFrame(overrides: Partial<StackFrame> = {}): StackFrame {
  return { filename: "app.min.js", function: "n", lineno: 1, colno: 0, in_app: true, ...overrides };
}

Deno.test("resolveStackTrace resolves a minified position to the original source/line/column/name", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "app.min.js",
  }) as unknown as D1Database;
  const r2 = new FakeR2(new Map([["demo/1.0.0/abc", REAL_SOURCE_MAP]])) as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(db, r2, "demo", "1.0.0", [minifiedFrame()]);

  assertEquals(resolved.resolved, true);
  assertEquals(resolved.filename, "app.js");
  assertEquals(resolved.lineno, 1);
  assertEquals(resolved.colno, 0);
  assertEquals(resolved.function, "render");
});

Deno.test("resolveStackTrace resolves a second line's position without a name", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "app.min.js",
  }) as unknown as D1Database;
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

Deno.test("resolveStackTrace leaves a frame unresolved rather than throwing when the uploaded source map isn't valid JSON (issue #125)", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "app.min.js",
  }) as unknown as D1Database;
  const r2 = new FakeR2NonJson() as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(db, r2, "demo", "1.0.0", [minifiedFrame()]);

  assertEquals(resolved.resolved, false);
  assertEquals(resolved.filename, "app.min.js");
});

Deno.test("resolveStackTrace leaves a frame unresolved rather than throwing when the uploaded file is valid JSON but not a valid source map (issue #125)", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "app.min.js",
  }) as unknown as D1Database;
  const r2 = new FakeR2InvalidMap() as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(db, r2, "demo", "1.0.0", [minifiedFrame()]);

  assertEquals(resolved.resolved, false);
  assertEquals(resolved.filename, "app.min.js");
});

Deno.test("resolveStackTrace leaves frames with no line/column info unresolved rather than throwing", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "app.min.js",
  }) as unknown as D1Database;
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

// issue #142 — real `sentry-cli releases files <version> upload-sourcemaps` names artifacts with
// a `~/`-prefix (e.g. "~/static/js/app.min.js"), Sentry's "relative to the release's URL, any
// origin" convention. A real browser SDK reports `frame.filename` as the full URL the script
// loaded from, never tilde-prefixed, so resolution must strip scheme+host before comparing.
Deno.test("resolveStackTrace resolves a `~/`-prefixed artifact against a frame filename that's a full URL with any origin", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "~/static/js/app.min.js",
  }) as unknown as D1Database;
  const r2 = new FakeR2(new Map([["demo/1.0.0/abc", REAL_SOURCE_MAP]])) as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(
    db,
    r2,
    "demo",
    "1.0.0",
    [minifiedFrame({ filename: "https://myapp.example.com/static/js/app.min.js" })],
  );

  assertEquals(resolved.resolved, true);
  assertEquals(resolved.filename, "app.js");
});

Deno.test("resolveStackTrace resolves a `~/`-prefixed artifact regardless of which origin the frame's URL uses", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "~/static/js/app.min.js",
  }) as unknown as D1Database;
  const r2 = new FakeR2(new Map([["demo/1.0.0/abc", REAL_SOURCE_MAP]])) as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(
    db,
    r2,
    "demo",
    "1.0.0",
    [minifiedFrame({ filename: "https://cdn.other-origin.test:8443/static/js/app.min.js" })],
  );

  assertEquals(resolved.resolved, true);
});

Deno.test("resolveStackTrace leaves a frame unresolved when a `~/`-prefixed artifact's path doesn't match the frame's URL path", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "~/static/js/app.min.js",
  }) as unknown as D1Database;
  const r2 = new FakeR2(new Map([["demo/1.0.0/abc", REAL_SOURCE_MAP]])) as unknown as R2Bucket;

  const [resolved] = await resolveStackTrace(
    db,
    r2,
    "demo",
    "1.0.0",
    [minifiedFrame({ filename: "https://myapp.example.com/other/path/app.min.js" })],
  );

  assertEquals(resolved.resolved, false);
  assertEquals(resolved.filename, "https://myapp.example.com/other/path/app.min.js");
});

Deno.test("resolveStackTrace keeps exact-string matching for a non-tilde artifact (dashboard manual-upload path, unchanged)", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "https://myapp.example.com/static/js/app.min.js",
  }) as unknown as D1Database;
  const r2 = new FakeR2(new Map([["demo/1.0.0/abc", REAL_SOURCE_MAP]])) as unknown as R2Bucket;

  const resolvedMatch = await resolveStackTrace(
    db,
    r2,
    "demo",
    "1.0.0",
    [minifiedFrame({ filename: "https://myapp.example.com/static/js/app.min.js" })],
  );
  assertEquals(resolvedMatch[0].resolved, true);

  // A different origin must NOT match — non-tilde patterns are exact-string, not path-suffix.
  const resolvedMismatch = await resolveStackTrace(
    db,
    r2,
    "demo",
    "1.0.0",
    [minifiedFrame({ filename: "https://other-origin.example.com/static/js/app.min.js" })],
  );
  assertEquals(resolvedMismatch[0].resolved, false);
});

Deno.test("resolveStackTrace matches a `~/`-prefixed artifact against a bare (non-URL) frame filename when the paths align", async () => {
  const db = new FakeD1({
    r2_object_key: "demo/1.0.0/abc",
    minified_path_pattern: "~/bundle.js",
  }) as unknown as D1Database;
  const r2 = new FakeR2(new Map([["demo/1.0.0/abc", REAL_SOURCE_MAP]])) as unknown as R2Bucket;

  // "bundle.js" isn't a well-formed absolute URL (legitimate for non-browser/Node-style events) —
  // falls back to comparing it as-is against the pattern with "~/" stripped.
  const [resolved] = await resolveStackTrace(
    db,
    r2,
    "demo",
    "1.0.0",
    [minifiedFrame({ filename: "bundle.js" })],
  );

  assertEquals(resolved.resolved, true);
});
