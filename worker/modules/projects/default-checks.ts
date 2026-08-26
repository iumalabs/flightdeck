import { createCheck, type CreatedCheck } from "../uptime/create-check.ts";
import { looksLikeCatchAll, type ProbeResult, probeUrlDetailed } from "../uptime/http-check.ts";

// issue #72 — when a project is created with a `baseUrl`, seed a couple of default uptime checks
// against it so a brand-new project isn't left with zero monitoring coverage until someone
// remembers to configure Uptime by hand. Same interval/threshold defaults createCheck() gives a
// check a user creates by hand (routes.ts's POST /checks) — a seeded check is indistinguishable
// from a hand-made one.
const DEFAULT_INTERVAL_SECONDS = 60;

// Suggested shape from issue #72 itself — `/health` first (most common convention), `/api/health`
// as a fallback for apps that namespace their health route under `/api`. Only the first candidate
// that actually answers a real, distinct 200 gets seeded (see probeUrlDetailed()/looksLikeCatchAll()
// below) — an auto-created check with no real target would just be noise to delete, not
// "definitely useful" (issue #72).
const HEALTH_ENDPOINT_CANDIDATES = ["/health", "/api/health"];

export interface SeededDefaultChecks {
  root: CreatedCheck | null;
  health: CreatedCheck | null;
}

// Best-effort: every failure here is caught and logged, never thrown — seeding is a secondary step
// that must never fail (or roll back) the project creation it's part of, matching this codebase's
// existing "log and continue" precedent for a secondary step alongside a primary mutation
// (r2-provision.ts's revokePreviousExportToken(), log-consumer.ts's batch-write retry logging).
export async function seedDefaultUptimeChecks(
  db: D1Database,
  projectId: string,
  baseUrl: string,
): Promise<SeededDefaultChecks> {
  const result: SeededDefaultChecks = { root: null, health: null };

  // 1. Root check — always seeded against baseUrl exactly as given, regardless of whether it's
  // reachable right now (an uptime check's entire job is to observe and alert on exactly that).
  try {
    const created = await createCheck(db, projectId, {
      name: "Root",
      type: "http",
      target: baseUrl,
      intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    });
    if (created !== "limit-reached" && created !== "interval-too-low") result.root = created;
  } catch (err) {
    console.error(`projects: failed to seed root uptime check for project ${projectId}`, err);
  }

  // 2. Health-endpoint check — only seeded if a candidate path actually responds 200 right now,
  // probed live and synchronously as part of this request, AND that 200 is confirmed distinct from
  // a baseline probe of a definitely-nonexistent path on the same origin (issue #75 — otherwise an
  // app that serves a catch-all 200 for any unmatched path, e.g. an SPA fallback route, gets a fake
  // "Health" check that's really just re-checking the homepage under a misleading name).
  // probeUrlDetailed()'s short timeout keeps this bounded so project creation can't hang on a slow
  // or dead candidate; it never throws. The baseline probe is lazy and cached across candidates —
  // it only needs to run once some candidate has actually 200'd, and a failed/timed-out baseline
  // fails safe (looksLikeCatchAll() treats a null baseline status as "not confirmed distinct", so
  // the Health check simply doesn't get seeded rather than the request hanging or crashing).
  const base = baseUrl.replace(/\/+$/, "");
  let baseline: ProbeResult | null = null;
  for (const path of HEALTH_ENDPOINT_CANDIDATES) {
    const candidate = `${base}${path}`;
    const probe = await probeUrlDetailed(candidate);
    if (probe.status !== 200) continue;

    if (baseline === null) {
      baseline = await probeUrlDetailed(`${base}/__flightdeck-nonexistent-${crypto.randomUUID()}`);
    }
    if (looksLikeCatchAll(probe, baseline)) continue;

    try {
      const created = await createCheck(db, projectId, {
        name: "Health",
        type: "http",
        target: candidate,
        intervalSeconds: DEFAULT_INTERVAL_SECONDS,
      });
      if (created !== "limit-reached" && created !== "interval-too-low") result.health = created;
    } catch (err) {
      console.error(`projects: failed to seed health uptime check for project ${projectId}`, err);
    }
    break;
  }

  return result;
}
