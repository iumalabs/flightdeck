import { assertEquals } from "@std/assert";
import {
  looksLikeCatchAll,
  probeUrlDetailed,
  runHttpCheck,
} from "../../worker/modules/uptime/http-check.ts";

// research.md §2 / tasks.md T007 — network I/O mocked, not a real network call.
function withMockedFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// Simulates elapsed wall-clock time without an actual delay, so the "slow 522" test below runs
// instantly instead of sleeping past the 5s diagnostic threshold. Date.now() is called exactly
// twice per runHttpCheck() invocation (start, then after the response resolves) — advance on the
// second call.
function withAdvancingClock<T>(elapsedMs: number, fn: () => Promise<T>): Promise<T> {
  const original = Date.now;
  let calls = 0;
  const base = original();
  Date.now = () => {
    calls++;
    return calls === 1 ? base : base + elapsedMs;
  };
  return fn().finally(() => {
    Date.now = original;
  });
}

Deno.test("a 2xx response is a success, latency recorded, detail is the status code", async () => {
  const outcome = await withMockedFetch(
    () => Promise.resolve(new Response("ok", { status: 200 })),
    () => runHttpCheck("https://example.com"),
  );
  assertEquals(outcome.succeeded, true);
  assertEquals(outcome.detail, "200");
  assertEquals(typeof outcome.latencyMs, "number");
});

Deno.test("a non-2xx response is a failure, detail is the status code", async () => {
  const outcome = await withMockedFetch(
    () => Promise.resolve(new Response("error", { status: 503 })),
    () => runHttpCheck("https://example.com"),
  );
  assertEquals(outcome.succeeded, false);
  assertEquals(outcome.detail, "503");
});

Deno.test("a connection failure (fetch throws) is a failure with no latency and an error detail", async () => {
  const outcome = await withMockedFetch(
    () => Promise.reject(new TypeError("network error")),
    () => runHttpCheck("https://unreachable.example"),
  );
  assertEquals(outcome.succeeded, false);
  assertEquals(outcome.latencyMs, null);
  assertEquals(outcome.detail, "network error");
});

// issue #59 — a genuinely fast 522 (well under the ~19s minimum a real Cloudflare
// connection-timeout 522 requires per Cloudflare's own Error 522 doc) is stayed "down" (never
// silently marked "up") but gets a distinguishing detail instead of a bare status code, so it's
// not indistinguishable from a real origin outage.
Deno.test("a suspiciously fast 522 stays down but gets a distinguishing diagnostic detail", async () => {
  const outcome = await withMockedFetch(
    () => Promise.resolve(new Response("", { status: 522 })),
    () => runHttpCheck("https://flightdeck.iuma.dev"),
  );
  assertEquals(outcome.succeeded, false);
  assertEquals(outcome.detail?.startsWith("522"), true);
  assertEquals(outcome.detail?.includes("issue #59"), true);
});

// A 522 that takes long enough to plausibly be a real connection timeout is left as a bare
// status code — the diagnostic only fires on the specific fast-522 signature, not on every 522.
Deno.test("a slow 522 (plausibly a real origin timeout) keeps the bare status code as detail", async () => {
  const outcome = await withAdvancingClock(
    20_000, // above SUSPICIOUSLY_FAST_522_MS (5s) and above Cloudflare's documented 19s minimum
    () =>
      withMockedFetch(
        () => Promise.resolve(new Response("", { status: 522 })),
        () => runHttpCheck("https://example.com"),
      ),
  );
  assertEquals(outcome.succeeded, false);
  assertEquals(outcome.detail, "522");
});

// issue #75 — probeUrlDetailed()/looksLikeCatchAll() let default-checks.ts tell a real "/health"
// endpoint apart from an app that serves an identical catch-all 200 for any unmatched path (e.g.
// an SPA fallback route).

Deno.test("probeUrlDetailed captures status, content-type, and a bounded body sample on success", async () => {
  const result = await withMockedFetch(
    () =>
      Promise.resolve(
        new Response("hello world", {
          status: 200,
          headers: { "content-type": "text/plain", "content-length": "11" },
        }),
      ),
    () => probeUrlDetailed("https://example.com/health"),
  );
  assertEquals(result.status, 200);
  assertEquals(result.contentType, "text/plain");
  assertEquals(result.contentLength, "11");
  assertEquals(result.bodySample, "hello world");
});

Deno.test("probeUrlDetailed never throws — a connection failure yields an all-null result", async () => {
  const result = await withMockedFetch(
    () => Promise.reject(new TypeError("network error")),
    () => probeUrlDetailed("https://unreachable.example"),
  );
  assertEquals(result.status, null);
  assertEquals(result.contentType, null);
  assertEquals(result.contentLength, null);
  assertEquals(result.bodySample, null);
});

Deno.test("looksLikeCatchAll is true when candidate and baseline are indistinguishable (SPA fallback)", () => {
  const candidate = {
    status: 200,
    contentType: "text/html",
    contentLength: "42",
    bodySample: "<html>spa shell</html>",
  };
  const baseline = { ...candidate };
  assertEquals(looksLikeCatchAll(candidate, baseline), true);
});

Deno.test("looksLikeCatchAll is false when the baseline 404s and the candidate 200s (real distinct endpoint)", () => {
  const candidate = {
    status: 200,
    contentType: "application/json",
    contentLength: "15",
    bodySample: '{"ok":true}',
  };
  const baseline = {
    status: 404,
    contentType: "text/html",
    contentLength: "9",
    bodySample: "not found",
  };
  assertEquals(looksLikeCatchAll(candidate, baseline), false);
});

Deno.test("looksLikeCatchAll is false when both 200 but content-type/body differ (real /health despite an SPA-fallback baseline)", () => {
  const candidate = {
    status: 200,
    contentType: "application/json",
    contentLength: "11",
    bodySample: '{"ok":true}',
  };
  const baseline = {
    status: 200,
    contentType: "text/html",
    contentLength: "300",
    bodySample: "<html>spa shell</html>",
  };
  assertEquals(looksLikeCatchAll(candidate, baseline), false);
});

Deno.test("looksLikeCatchAll fails safe (treated as catch-all) when the baseline probe itself failed", () => {
  const candidate = {
    status: 200,
    contentType: "application/json",
    contentLength: "2",
    bodySample: "{}",
  };
  const baseline = { status: null, contentType: null, contentLength: null, bodySample: null };
  assertEquals(looksLikeCatchAll(candidate, baseline), true);
});
