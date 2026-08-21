import { assertEquals } from "@std/assert";
import { shapeLatestEvent } from "../../worker/modules/issues/routes.ts";
import type { EventPayload } from "../../worker/modules/ingest/types.ts";

Deno.test("shapeLatestEvent maps the latest exception's stack frames", () => {
  const payload: EventPayload = {
    exception: {
      values: [{
        type: "TypeError",
        value: "boom",
        stacktrace: {
          frames: [
            { filename: "vendor.js", function: "dispatch", in_app: false },
            { filename: "CartSummary.tsx", function: "useCheckout", in_app: true },
          ],
        },
      }],
    },
  };

  const shaped = shapeLatestEvent(payload);
  assertEquals(shaped.stacktrace?.frames?.length, 2);
  assertEquals(shaped.stacktrace?.frames?.[1].function, "useCheckout");
});

Deno.test("shapeLatestEvent uses the last exception value when several are chained", () => {
  const payload: EventPayload = {
    exception: {
      values: [
        { type: "OperationalError", value: "root cause" },
        { type: "TypeError", value: "surfaced error" },
      ],
    },
  };

  const shaped = shapeLatestEvent(payload);
  assertEquals(shaped.stacktrace, null);
});

Deno.test("shapeLatestEvent normalizes breadcrumbs given as a plain array", () => {
  const payload: EventPayload = {
    breadcrumbs: [
      { category: "nav", message: "clicked checkout" },
      { category: "http", message: "POST /api/checkout" },
    ],
  };

  const shaped = shapeLatestEvent(payload);
  assertEquals(shaped.breadcrumbs.length, 2);
  assertEquals(shaped.breadcrumbs[0].message, "clicked checkout");
});

Deno.test("shapeLatestEvent normalizes breadcrumbs given as a { values } wrapper", () => {
  const payload: EventPayload = {
    breadcrumbs: { values: [{ category: "nav", message: "opened cart" }] },
  };

  const shaped = shapeLatestEvent(payload);
  assertEquals(shaped.breadcrumbs.length, 1);
  assertEquals(shaped.breadcrumbs[0].category, "nav");
});

Deno.test("shapeLatestEvent defaults breadcrumbs to an empty array when absent", () => {
  const shaped = shapeLatestEvent({ message: "disk full" });
  assertEquals(shaped.breadcrumbs, []);
});

Deno.test("shapeLatestEvent passes through tags and contexts, defaulting to empty objects", () => {
  const withData = shapeLatestEvent({
    tags: { env: "prod" },
    contexts: { runtime: { name: "node" } },
  });
  assertEquals(withData.tags, { env: "prod" });
  assertEquals(withData.contexts, { runtime: { name: "node" } });

  const withoutData = shapeLatestEvent({ message: "disk full" });
  assertEquals(withoutData.tags, {});
  assertEquals(withoutData.contexts, {});
});

Deno.test("shapeLatestEvent returns null stacktrace when there's no exception", () => {
  const shaped = shapeLatestEvent({ message: "disk full" });
  assertEquals(shaped.stacktrace, null);
});
