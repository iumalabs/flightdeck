import { Hono } from "hono";

interface Env {
  DB: D1Database;
  SOURCE_MAPS: R2Bucket;
  RATE_LIMITER: DurableObjectNamespace;
}

export const ingestRoutes = new Hono<{ Bindings: Env }>();

// "internal" is reserved (research.md §3, specs/002-error-monitoring) — it must never resolve as a
// project id, so `/api/internal/*` can never be captured by this router even if Hono's static-
// before-dynamic route precedence were somehow bypassed. Checked before any DSN lookup.
ingestRoutes.post("/:projectId/envelope", (c) => {
  const projectId = c.req.param("projectId");
  if (projectId === "internal") {
    return c.text("Forbidden", 403);
  }

  // Full envelope pipeline (DSN auth, rate limit, parse, fingerprint, upsert) lands in T017 —
  // this is the Foundational-phase mount point only.
  return c.text("Not Implemented", 501);
});
