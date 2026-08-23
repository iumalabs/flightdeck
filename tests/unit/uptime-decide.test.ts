import { assertEquals } from "@std/assert";
import { applyOutcome } from "../../worker/modules/uptime/decide.ts";

const THRESHOLDS = { failureThreshold: 3, recoveryThreshold: 2 };

Deno.test("a success resets consecutive_failures to 0 and increments consecutive_successes", () => {
  const t = applyOutcome({ consecutiveFailures: 2, consecutiveSuccesses: 0 }, THRESHOLDS, true);
  assertEquals(t.consecutiveFailures, 0);
  assertEquals(t.consecutiveSuccesses, 1);
  assertEquals(t.status, "up");
});

Deno.test("a failure resets consecutive_successes to 0 and increments consecutive_failures", () => {
  const t = applyOutcome({ consecutiveFailures: 0, consecutiveSuccesses: 1 }, THRESHOLDS, false);
  assertEquals(t.consecutiveSuccesses, 0);
  assertEquals(t.consecutiveFailures, 1);
  assertEquals(t.status, "down");
});

Deno.test("reaching the failure threshold crosses it; below threshold does not", () => {
  const below = applyOutcome(
    { consecutiveFailures: 1, consecutiveSuccesses: 0 },
    THRESHOLDS,
    false,
  );
  assertEquals(below.crossesFailureThreshold, false);

  const at = applyOutcome({ consecutiveFailures: 2, consecutiveSuccesses: 0 }, THRESHOLDS, false);
  assertEquals(at.crossesFailureThreshold, true);
});

Deno.test("further consecutive failures past threshold keep crossing true (caller dedups, not this function)", () => {
  const t = applyOutcome({ consecutiveFailures: 5, consecutiveSuccesses: 0 }, THRESHOLDS, false);
  assertEquals(t.crossesFailureThreshold, true);
});

Deno.test("reaching the recovery threshold crosses it; below threshold does not", () => {
  const below = applyOutcome({ consecutiveFailures: 0, consecutiveSuccesses: 0 }, THRESHOLDS, true);
  assertEquals(below.crossesRecoveryThreshold, false);

  const at = applyOutcome({ consecutiveFailures: 0, consecutiveSuccesses: 1 }, THRESHOLDS, true);
  assertEquals(at.crossesRecoveryThreshold, true);
});

Deno.test("an isolated failure below threshold never crosses, and a subsequent success clears it", () => {
  const fail1 = applyOutcome(
    { consecutiveFailures: 0, consecutiveSuccesses: 0 },
    THRESHOLDS,
    false,
  );
  assertEquals(fail1.crossesFailureThreshold, false);
  assertEquals(fail1.consecutiveFailures, 1);

  const success = applyOutcome(
    {
      consecutiveFailures: fail1.consecutiveFailures,
      consecutiveSuccesses: fail1.consecutiveSuccesses,
    },
    THRESHOLDS,
    true,
  );
  assertEquals(success.consecutiveFailures, 0);
  assertEquals(success.status, "up");
});

Deno.test("a success never crosses the failure threshold, and a failure never crosses the recovery threshold", () => {
  const success = applyOutcome(
    { consecutiveFailures: 10, consecutiveSuccesses: 0 },
    THRESHOLDS,
    true,
  );
  assertEquals(success.crossesFailureThreshold, false);

  const failure = applyOutcome(
    { consecutiveFailures: 0, consecutiveSuccesses: 10 },
    THRESHOLDS,
    false,
  );
  assertEquals(failure.crossesRecoveryThreshold, false);
});
