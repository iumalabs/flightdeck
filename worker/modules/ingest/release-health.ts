// Release health aggregation — research.md §5-6 (specs/005-releases). Folds "session"/"sessions"
// envelope items into daily (project, release, environment) counters, never one row per session.

export interface SessionOutcome {
  release: string;
  environment: string;
  date: string; // YYYY-MM-DD (UTC)
  status: "exited" | "crashed" | "errored" | "abnormal";
  did: string | null;
}

interface RawSingleSession {
  sid?: string;
  did?: string;
  status?: string;
  errors?: number;
  attrs?: { release?: string; environment?: string };
  started?: string;
}

interface RawSessionAggregate {
  started: string;
  exited?: number;
  errored?: number;
  crashed?: number;
  abnormal?: number;
}

interface RawSessionsBatch {
  attrs?: { release?: string; environment?: string };
  aggregates?: RawSessionAggregate[];
}

function toDateOnly(isoOrEpoch: string | undefined): string {
  const d = isoOrEpoch ? new Date(isoOrEpoch) : new Date(NaN);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 10);
}

// A "session" item carries one real session, with its own `did` — the only shape distinct-user
// tracking (research.md §6) can actually observe, since a pre-aggregated "sessions" batch has
// already given up per-session identity by the time it reaches the server (a real protocol
// consequence, not an implementation gap: Sentry's own server-mode SDK guidance is to
// pre-aggregate specifically to avoid per-session request volume, which inherently discards
// individual `did`s for that batch).
function extractFromSingleSession(payload: RawSingleSession): SessionOutcome[] {
  const release = payload.attrs?.release;
  const environment = payload.attrs?.environment ?? "production";
  if (!release || !payload.status) return [];

  const status = payload.status === "ok" || payload.status === "exited"
    ? "exited"
    : payload.status === "crashed"
    ? "crashed"
    : (payload.errors ?? 0) > 0
    ? "errored"
    : "abnormal";

  return [{
    release,
    environment,
    date: toDateOnly(payload.started),
    status,
    did: payload.did ?? null,
  }];
}

function extractFromSessionsBatch(payload: RawSessionsBatch): SessionOutcome[] {
  const release = payload.attrs?.release;
  const environment = payload.attrs?.environment ?? "production";
  if (!release) return [];

  const outcomes: SessionOutcome[] = [];
  for (const bucket of payload.aggregates ?? []) {
    const date = toDateOnly(bucket.started);
    for (let i = 0; i < (bucket.exited ?? 0); i++) {
      outcomes.push({ release, environment, date, status: "exited", did: null });
    }
    for (let i = 0; i < (bucket.errored ?? 0); i++) {
      outcomes.push({ release, environment, date, status: "errored", did: null });
    }
    for (let i = 0; i < (bucket.crashed ?? 0); i++) {
      outcomes.push({ release, environment, date, status: "crashed", did: null });
    }
    for (let i = 0; i < (bucket.abnormal ?? 0); i++) {
      outcomes.push({ release, environment, date, status: "abnormal", did: null });
    }
  }
  return outcomes;
}

export function extractSessionOutcomes(
  itemType: "session" | "sessions",
  payload: Record<string, unknown>,
): SessionOutcome[] {
  return itemType === "session"
    ? extractFromSingleSession(payload as RawSingleSession)
    : extractFromSessionsBatch(payload as RawSessionsBatch);
}

export interface DailyCounters {
  sessionsTotal: number;
  sessionsCrashed: number;
  sessionsErrored: number;
}

// Folds a flat list of outcomes into per-(release, environment, date) daily counters — the shape
// written via UPSERT into release_health (data-model.md), never one row per session.
export function foldOutcomesIntoCounters(
  outcomes: SessionOutcome[],
): Map<string, DailyCounters & { release: string; environment: string; date: string }> {
  const buckets = new Map<
    string,
    DailyCounters & { release: string; environment: string; date: string }
  >();
  for (const outcome of outcomes) {
    const key = `${outcome.release}|${outcome.environment}|${outcome.date}`;
    const bucket = buckets.get(key) ?? {
      release: outcome.release,
      environment: outcome.environment,
      date: outcome.date,
      sessionsTotal: 0,
      sessionsCrashed: 0,
      sessionsErrored: 0,
    };
    bucket.sessionsTotal += 1;
    if (outcome.status === "crashed") bucket.sessionsCrashed += 1;
    else if (outcome.status === "errored") bucket.sessionsErrored += 1;
    buckets.set(key, bucket);
  }
  return buckets;
}

// null (not 0) when there's no data yet — spec FR-006's "honest no-data state, not a misleading
// figure" requirement. Standard crash-free rate definition (research.md's Assumptions): the share
// of sessions/users that did NOT crash.
export function computeCrashFreeRate(total: number, crashed: number): number | null {
  if (total <= 0) return null;
  return ((total - crashed) / total) * 100;
}

// specs/005-releases research.md §6: distinct-user tracking is capped at 10,000 rows per
// (project, release, environment, date) bucket — a pure predicate, checked against the bucket's
// CURRENT row count before every insert attempt.
export const RELEASE_HEALTH_USERS_CAP = 10_000;

export function shouldTrackDistinctUser(currentBucketCount: number): boolean {
  return currentBucketCount < RELEASE_HEALTH_USERS_CAP;
}
