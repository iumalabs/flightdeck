import type { StackFrame } from "./types.ts";

// Stub — always "no resolution available" until User Story 3 (research.md §6,
// specs/002-error-monitoring) implements real Source Map v3 / VLQ-based resolution, pending that
// story's blocking spike (tasks.md T027) confirming @jridgewell/trace-mapping works in the Workers
// runtime. The call site in routes.ts is already wired into the correct pipeline position (before
// fingerprinting, per research.md §5) — User Story 3 only needs to replace this function's body.
export function resolveStackTrace(
  _db: D1Database,
  _r2: R2Bucket,
  _projectId: string,
  _release: string | undefined,
  frames: StackFrame[],
): Promise<StackFrame[]> {
  return Promise.resolve(frames);
}
