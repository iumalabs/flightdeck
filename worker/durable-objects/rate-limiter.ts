import { DurableObject } from "cloudflare:workers";

// One instance per DSN public key (idFromName(dsnKey) at the call site) — never a single global
// instance, which Cloudflare's own docs warn against as a throughput bottleneck. Sharding by DSN
// key is a natural boundary here, not a manufactured one (research.md §4,
// specs/002-error-monitoring).
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 100;

interface Window {
  windowStart: number;
  count: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class RateLimiter extends DurableObject {
  async checkAndIncrement(): Promise<RateLimitResult> {
    const now = Date.now();
    const stored = await this.ctx.storage.get<Window>("window");
    let windowStart = stored?.windowStart ?? now;
    let count = stored?.count ?? 0;

    if (now - windowStart >= WINDOW_MS) {
      windowStart = now;
      count = 0;
    }

    count += 1;
    await this.ctx.storage.put("window", { windowStart, count });

    const allowed = count <= MAX_REQUESTS_PER_WINDOW;
    const retryAfterSeconds = allowed
      ? 0
      : Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));

    return { allowed, retryAfterSeconds };
  }
}
