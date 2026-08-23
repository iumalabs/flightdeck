// HTTP check execution (specs/006-uptime-monitoring spec.md FR-001/Acceptance Scenario 1-2) — a
// non-success status, timeout, or connection failure are all "down"; no cloudflare: import here,
// so this stays importable from a plain `deno test` context (unlike tcp-check.ts).

export interface CheckOutcome {
  succeeded: boolean;
  latencyMs: number | null;
  detail: string | null;
}

const HTTP_TIMEOUT_MS = 10_000;

export async function runHttpCheck(target: string): Promise<CheckOutcome> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(target, { method: "GET", signal: controller.signal });
    const latencyMs = Date.now() - start;
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
