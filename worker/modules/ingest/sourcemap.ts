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
}

async function loadTracer(
  db: D1Database,
  r2: R2Bucket,
  projectId: string,
  release: string,
  minifiedPath: string,
): Promise<TraceMap | null> {
  const row = await db
    .prepare(
      `SELECT sm.r2_object_key AS r2_object_key
       FROM source_maps sm
       JOIN releases r ON r.id = sm.release_id
       WHERE r.project_id = ?1 AND r.version = ?2 AND sm.minified_path_pattern = ?3`,
    )
    .bind(projectId, release, minifiedPath)
    .first<SourceMapRow>();
  if (!row) return null;

  const object = await r2.get(row.r2_object_key);
  if (!object) return null;

  const raw = await object.json();
  return new TraceMap(raw as ConstructorParameters<typeof TraceMap>[0]);
}
