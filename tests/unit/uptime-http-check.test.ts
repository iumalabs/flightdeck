import { assertEquals } from "@std/assert";
import { runHttpCheck } from "../../worker/modules/uptime/http-check.ts";

// research.md §2 / tasks.md T007 — network I/O mocked, not a real network call.
function withMockedFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
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
