import type { CheckOutcome } from "./http-check.ts";

// TCP check execution via the Workers runtime's built-in socket API (research.md §2) — a
// dynamic import, not a static one: "cloudflare:sockets" only resolves inside the actual Workers
// runtime (real `wrangler dev`/deployed), not under plain `deno test`, so a static import here
// would break `deno test`'s module resolution for anything that imports this file, even indirectly
// and even when this function is never called. Verified live via contract tests, not a unit test.
export async function runTcpCheck(target: string): Promise<CheckOutcome> {
  const [hostname, portStr] = target.split(":");
  const port = Number(portStr);
  const start = Date.now();
  try {
    const { connect } = await import("cloudflare:sockets");
    const socket = connect({ hostname, port });
    await socket.opened;
    const latencyMs = Date.now() - start;
    try {
      socket.close();
    } catch {
      // best-effort — the connection already succeeded, which is what this check measures
    }
    return { succeeded: true, latencyMs, detail: null };
  } catch (err) {
    return {
      succeeded: false,
      latencyMs: null,
      detail: err instanceof Error ? err.message : "connection failed",
    };
  }
}
