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
  const result = await probeUrlDetailed(target, timeoutMs);
  return result.status === 200;
}

// issue #75 — a bare 200 from probeUrl() can't tell a real `/health` endpoint apart from an app
// that serves an identical catch-all 200 for any unmatched path (the most common case being an
// SPA's `not_found_handling: "single-page-application"` fallback — exactly what FlightDeck's own
// marketing site does). probeUrlDetailed() captures enough of the response — status, content-type,
// content-length, and a bounded body sample — for the caller to compare a "/health" probe against a
// baseline probe of a definitely-nonexistent path on the same origin: if the two are
// indistinguishable, the "health" response is just the catch-all, not a real route. Same
// timeout/never-throws discipline as probeUrl() itself (this now backs it).
export interface ProbeResult {
  status: number | null;
  contentType: string | null;
  contentLength: string | null;
  bodySample: string | null;
}

// Bounded so a large real response (e.g. an SPA's full index.html) can't make this probe read an
// unbounded amount of data — this only needs enough of the body to detect "identical to the
// baseline", not the whole page.
const PROBE_BODY_SAMPLE_BYTES = 2048;

export async function probeUrlDetailed(
  target: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, { method: "GET", signal: controller.signal });
    const bodySample = await readBodySample(res, PROBE_BODY_SAMPLE_BYTES);
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: res.headers.get("content-length"),
      bodySample,
    };
  } catch {
    return { status: null, contentType: null, contentLength: null, bodySample: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodySample(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      const remaining = maxBytes - total;
      const chunk = value.length > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.length;
    }
  } catch {
    return null;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // best-effort cleanup only — the sample we already read is still usable.
    }
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined);
}

// True when `candidate` (e.g. a "/health" probe) is indistinguishable from `baseline` (a probe of a
// definitely-nonexistent path on the same origin) — same status, content-type, content-length, and
// body sample. A null `baseline.status` means the baseline probe itself failed or timed out — fail
// safe: never seeds a check we couldn't actually confirm was distinct, treated the same as
// "looks like a catch-all" rather than as "looks distinct".
export function looksLikeCatchAll(candidate: ProbeResult, baseline: ProbeResult): boolean {
  if (baseline.status === null) return true;
  return (
    candidate.status === baseline.status &&
    candidate.contentType === baseline.contentType &&
    candidate.contentLength === baseline.contentLength &&
    candidate.bodySample === baseline.bodySample
  );
}
