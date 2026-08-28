import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { StackFrame } from "./types.ts";

// research.md §6 (specs/002-error-monitoring) — @jridgewell/trace-mapping's Workers-runtime
// compatibility was confirmed by tasks.md's T027 spike (running this resolution end-to-end
// against a real `wrangler dev` instance via the source-map upload contract test); no fallback
// hand-rolled VLQ decoder was needed.
//
// Resolution requires both an event `release` and a source map previously uploaded for that
// release/path (POST /api/internal/projects/:id/source-maps). Frames that can't be resolved —
// no release, no matching map, or a position the map doesn't cover — are returned unchanged
// except for an explicit `resolved: false`, never dropped or left ambiguous.
export async function resolveStackTrace(
  db: D1Database,
  r2: R2Bucket,
  projectId: string,
  release: string | undefined,
  frames: StackFrame[],
): Promise<StackFrame[]> {
  if (!release) {
    return frames.map((frame) => ({ ...frame, resolved: false }));
  }

  const tracerCache = new Map<string, TraceMap | null>();
  const resolved: StackFrame[] = [];

  for (const frame of frames) {
    if (!frame.filename || frame.lineno == null || frame.colno == null) {
      resolved.push({ ...frame, resolved: false });
      continue;
    }

    let tracer = tracerCache.get(frame.filename);
    if (tracer === undefined) {
      tracer = await loadTracer(db, r2, projectId, release, frame.filename);
      tracerCache.set(frame.filename, tracer);
    }
    if (!tracer) {
      resolved.push({ ...frame, resolved: false });
      continue;
    }

    const original = originalPositionFor(tracer, { line: frame.lineno, column: frame.colno });
    if (!original.source) {
      resolved.push({ ...frame, resolved: false });
      continue;
    }

    resolved.push({
      ...frame,
      filename: original.source,
      lineno: original.line ?? frame.lineno,
      colno: original.column ?? frame.colno,
      function: original.name ?? frame.function,
      resolved: true,
    });
  }

  return resolved;
}

interface SourceMapRow {
  r2_object_key: string;
  minified_path_pattern: string;
}

// issue #142 — real `sentry-cli releases files <version> upload-sourcemaps` names artifacts with
// a `~/`-prefix (worker/modules/releases/routes.ts's `name` field defaults to "~/bundle.js"),
// Sentry's own documented convention for "relative to the release's URL, any origin". A real
// browser SDK never sends a tilde-prefixed `frame.filename` — it reports the actual full URL the
// script loaded from (e.g. "https://myapp.example.com/static/js/app.min.js"). A plain exact-string
// match between those two can never succeed, so a `~/`-prefixed pattern is matched origin-agnostically:
// strip the leading "~/" from the stored pattern and compare it against the frame filename's URL
// path (scheme+host stripped). Patterns with no `~/` prefix (the dashboard's manual-upload path,
// worker/modules/projects/routes.ts) keep the original exact-string behavior unchanged.
function matchesSourceMapPattern(pattern: string, frameFilename: string): boolean {
  if (!pattern.startsWith("~/")) {
    return pattern === frameFilename;
  }

  const patternPath = pattern.slice(2); // "~/static/js/app.min.js" -> "static/js/app.min.js"

  let framePath: string;
  try {
    framePath = new URL(frameFilename).pathname; // "https://host/static/js/app.min.js" -> "/static/js/app.min.js"
  } catch {
    // Not a well-formed absolute URL (e.g. a bare "index.js", legitimate for non-browser events) —
    // fall back to comparing it as-is so a tilde-prefixed upload can still match when the paths align.
    framePath = frameFilename;
  }
  const normalizedFramePath = framePath.startsWith("/") ? framePath.slice(1) : framePath;

  return normalizedFramePath === patternPath;
}

async function loadTracer(
  db: D1Database,
  r2: R2Bucket,
  projectId: string,
  release: string,
  minifiedPath: string,
): Promise<TraceMap | null> {
  // Fetched-then-matched-in-code rather than an exact-match SQL WHERE: the `~/` convention needs
  // path-suffix comparison after stripping scheme+host, which SQL can't express cleanly here, and
  // there are typically few source maps per release.
  const { results } = await db
    .prepare(
      `SELECT sm.r2_object_key AS r2_object_key, sm.minified_path_pattern AS minified_path_pattern
       FROM source_maps sm
       JOIN releases r ON r.id = sm.release_id
       WHERE r.project_id = ?1 AND r.version = ?2`,
    )
    .bind(projectId, release)
    .all<SourceMapRow>();

  const row = results.find((candidate) =>
    matchesSourceMapPattern(candidate.minified_path_pattern, minifiedPath)
  );
  if (!row) return null;

  const object = await r2.get(row.r2_object_key);
  if (!object) return null;

  // issue #125 — a malformed/non-JSON uploaded source map (bad upload, truncated file, etc.) must
  // not permanently 500 every subsequent event referencing it. Both the JSON parse (non-JSON
  // content) and the TraceMap constructor (structurally-invalid-but-valid-JSON, e.g. missing
  // `mappings`/`sources`) can throw — treated the same as every other "can't resolve" case in this
  // function: an unresolved frame, not a failed request.
  try {
    const raw = await object.json();
    return new TraceMap(raw as ConstructorParameters<typeof TraceMap>[0]);
  } catch {
    return null;
  }
}
