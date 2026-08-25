// HTTP check execution (specs/006-uptime-monitoring spec.md FR-001/Acceptance Scenario 1-2) — a
// non-success status, timeout, or connection failure are all "down"; no cloudflare: import here,
// so this stays importable from a plain `deno test` context (unlike tcp-check.ts).

export interface CheckOutcome {
  succeeded: boolean;
  latencyMs: number | null;
  detail: string | null;
}

const HTTP_TIMEOUT_MS = 10_000;

// issue #59 — a bare `522` is indistinguishable from a real origin outage, but a 522 arriving
// this fast cannot BE one: Cloudflare's own Error 522 doc documents a minimum 19-second
// pre-connection timeout (retried at 1/1/1/1/1/2/4/8s backoff) before it ever emits a genuine
// "connection timed out" 522, and a 90-second post-connection-ACK timeout for the other 522
// cause. A 522 well under that floor is the platform's instant same-zone-loop rejection (a
// Worker's fetch() to a target hostname resolving to its OWN zone, which has no real origin to
// time out against) — wrangler.jsonc's `global_fetch_strictly_public` compatibility flag is the
// documented fix for that specific case, but this check stays in place as a diagnostic safety
// net: honest either way (never silently marks the check "up"), just clearer about WHICH kind of
// down this is when the signature matches.
const SUSPICIOUSLY_FAST_522_MS = 5_000;

export async function runHttpCheck(target: string): Promise<CheckOutcome> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(target, { method: "GET", signal: controller.signal });
    const latencyMs = Date.now() - start;
    if (res.status === 522 && latencyMs < SUSPICIOUSLY_FAST_522_MS) {
      return {
        succeeded: false,
        latencyMs,
        detail:
          "522 (suspiciously fast — likely Cloudflare rejecting this Worker's own subrequest to " +
          "a Cloudflare-proxied target, e.g. a self-referential or cross-zone-proxied check, " +
          "rather than a real origin timeout; see issue #59)",
      };
    }
    return { succeeded: res.ok, latencyMs, detail: String(res.status) };
  } catch (err) {
    return {
      succeeded: false,
      latencyMs: null,
      detail: err instanceof Error ? err.message : "request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// issue #72 — best-effort probe used to decide whether project creation should seed a default
// `/health`-style uptime check. Mirrors runHttpCheck()'s abort+timeout discipline (same
// AbortController/setTimeout shape, no SSRF handling beyond that — this codebase already accepts
// arbitrary user-supplied check targets from an authenticated dashboard request and relies on the
// Workers platform's `global_fetch_strictly_public` compat flag for that class of concern, see
// wrangler.jsonc and issue #59) but with a much shorter timeout: this runs synchronously inside the
// project-creation request, so it must never make that request hang. Returns true only on a real
// 200 — per issue #72's own framing, anything else (error, timeout, redirect, 404, ...) means this
// candidate isn't a real target worth seeding a check for. Never throws.
const PROBE_TIMEOUT_MS = 3_000;

export async function probeUrl(target: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, { method: "GET", signal: controller.signal });
    return res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
