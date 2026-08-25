import { createCheck, type CreatedCheck } from "../uptime/create-check.ts";
import { probeUrl } from "../uptime/http-check.ts";

// issue #72 — when a project is created with a `baseUrl`, seed a couple of default uptime checks
// against it so a brand-new project isn't left with zero monitoring coverage until someone
// remembers to configure Uptime by hand. Same interval/threshold defaults createCheck() gives a
// check a user creates by hand (routes.ts's POST /checks) — a seeded check is indistinguishable
// from a hand-made one.
const DEFAULT_INTERVAL_SECONDS = 60;

// Suggested shape from issue #72 itself — `/health` first (most common convention), `/api/health`
// as a fallback for apps that namespace their health route under `/api`. Only the first candidate
// that actually answers a real 200 gets seeded (see probeUrl()) — an auto-created check with no
// real target would just be noise to delete, not "definitely useful" (issue #72).
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
    if (created !== "limit-reached") result.root = created;
  } catch (err) {
    console.error(`projects: failed to seed root uptime check for project ${projectId}`, err);
  }

  // 2. Health-endpoint check — only seeded if a candidate path actually responds 200 right now,
  // probed live and synchronously as part of this request. probeUrl()'s short timeout keeps this
  // bounded so project creation can't hang on a slow or dead candidate; it never throws.
  const base = baseUrl.replace(/\/+$/, "");
  for (const path of HEALTH_ENDPOINT_CANDIDATES) {
    const candidate = `${base}${path}`;
    if (!(await probeUrl(candidate))) continue;

    try {
      const created = await createCheck(db, projectId, {
        name: "Health",
        type: "http",
        target: candidate,
        intervalSeconds: DEFAULT_INTERVAL_SECONDS,
      });
      if (created !== "limit-reached") result.health = created;
    } catch (err) {
      console.error(`projects: failed to seed health uptime check for project ${projectId}`, err);
    }
    break;
  }

  return result;
}
