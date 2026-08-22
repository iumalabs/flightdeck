import { assertEquals } from "@std/assert";
import { deliverWebhook } from "../../worker/modules/uptime/webhook.ts";

// spec FR-011 / research.md §7 — a failing/unreachable webhook must never throw out of the caller.
Deno.test("a failing webhook fetch does not throw", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new TypeError("connection refused"));
  try {
    await deliverWebhook("https://unreachable.example/hook", {
      checkId: "c1",
      checkName: "demo",
      event: "incident.opened",
      incidentId: "i1",
    });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("a successful webhook POSTs the incident payload as JSON to the configured URL", async () => {
  const original = globalThis.fetch;
  let capturedUrl: string | null = null;
  let capturedBody: string | null = null;
  globalThis.fetch = (input, init) => {
    capturedUrl = String(input);
    capturedBody = init?.body as string;
    return Promise.resolve(new Response("", { status: 200 }));
  };
  try {
    await deliverWebhook("https://example.com/hook", {
      checkId: "c1",
      checkName: "demo",
      event: "incident.resolved",
      incidentId: "i1",
    });
  } finally {
    globalThis.fetch = original;
  }
  assertEquals(capturedUrl, "https://example.com/hook");
  assertEquals(JSON.parse(capturedBody!).event, "incident.resolved");
});
