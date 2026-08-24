// Pure incident-aware decision logic (specs/006-uptime-monitoring research.md §8, data-model.md's
// Check state transitions) — no I/O, no D1. `runCheck()` (evaluate.ts) is the only caller (T038,
// Phase 8 Convergence — this was previously false: evaluate.ts hand-duplicated the same semantics
// as an inline SQL CASE expression for atomicity, and never actually called this function, letting
// the two silently diverge without either failing a test); kept separate so the highest-risk logic
// (consecutive-failure/recovery counting, exactly-one-incident open/resolve) is directly
// unit-testable without mocking fetch/cloudflare:sockets/D1. `runCheck()` gets its own
// race-safety under overlapping runs of the SAME check via optimistic concurrency (a WHERE-guarded
// UPDATE, retried on conflict) rather than folding the increment/reset arithmetic into the SQL
// itself.

export interface CheckCounters {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface CheckThresholds {
  failureThreshold: number;
  recoveryThreshold: number;
}

export interface Transition extends CheckCounters {
  status: "up" | "down";
  // Whether THIS outcome crosses its respective threshold — the caller (evaluate.ts) still owns
  // actually opening/resolving the Incident row via a DB-level guard (research.md §8's overlapping-
  // run safety net; a concurrent run reaching the same threshold must never open a second
  // incident), so these are "should attempt", not "did".
  crossesFailureThreshold: boolean;
  crossesRecoveryThreshold: boolean;
}

// Reset-the-other-counter-on-any-result is spec FR-007/FR-008's "consecutive" requirement (data-
// model.md) — a single success resets consecutive_failures to 0 and vice versa, so an isolated
// blip below threshold never accumulates across unrelated intervening successes.
export function applyOutcome(
  counters: CheckCounters,
  thresholds: CheckThresholds,
  succeeded: boolean,
): Transition {
  if (succeeded) {
    const consecutiveSuccesses = counters.consecutiveSuccesses + 1;
    return {
      consecutiveFailures: 0,
      consecutiveSuccesses,
      status: "up",
      crossesFailureThreshold: false,
      crossesRecoveryThreshold: consecutiveSuccesses >= thresholds.recoveryThreshold,
    };
  }

  const consecutiveFailures = counters.consecutiveFailures + 1;
  return {
    consecutiveFailures,
    consecutiveSuccesses: 0,
    status: "down",
    crossesFailureThreshold: consecutiveFailures >= thresholds.failureThreshold,
    crossesRecoveryThreshold: false,
  };
}
