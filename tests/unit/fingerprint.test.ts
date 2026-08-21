import { assertEquals, assertNotEquals } from "@std/assert";
import {
  computeFingerprint,
  deriveCulprit,
  deriveTitle,
} from "../../worker/modules/ingest/fingerprint.ts";
import type { EventPayload } from "../../worker/modules/ingest/types.ts";

const STACK_EVENT: EventPayload = {
  exception: {
    values: [
      {
        type: "TypeError",
        value: "Cannot read properties of undefined",
        stacktrace: {
          frames: [
            { filename: "vendor.js", function: "dispatch", in_app: false },
            { filename: "CartSummary.tsx", function: "useCheckout", in_app: true },
          ],
        },
      },
    ],
  },
};

Deno.test("computeFingerprint honors an explicit client-supplied fingerprint", () => {
  const event: EventPayload = { ...STACK_EVENT, fingerprint: ["custom", "group"] };
  assertEquals(computeFingerprint(event), "custom|group");
});

Deno.test("computeFingerprint uses stacktrace-based grouping when a stack trace exists", () => {
  const fp = computeFingerprint(STACK_EVENT);
  assertEquals(fp.startsWith("stack:TypeError:"), true);
});

Deno.test("computeFingerprint prefers in-app frames over vendor frames", () => {
  const fp = computeFingerprint(STACK_EVENT);
  assertEquals(fp.includes("CartSummary.tsx"), true);
  assertEquals(fp.includes("vendor.js"), false);
});

Deno.test("computeFingerprint falls back to the message for stack-trace-less events", () => {
  const event: EventPayload = { message: "disk full" };
  assertEquals(computeFingerprint(event), "message:disk full");
});

Deno.test("computeFingerprint produces the same fingerprint for two events with identical stack shape", () => {
  const eventA: EventPayload = structuredClone(STACK_EVENT);
  const eventB: EventPayload = structuredClone(STACK_EVENT);
  assertEquals(computeFingerprint(eventA), computeFingerprint(eventB));
});

Deno.test("computeFingerprint produces different fingerprints for different exception types", () => {
  const other: EventPayload = {
    exception: {
      values: [{
        type: "RangeError",
        value: "oops",
        stacktrace: STACK_EVENT.exception!.values![0].stacktrace,
      }],
    },
  };
  assertNotEquals(computeFingerprint(STACK_EVENT), computeFingerprint(other));
});

Deno.test("deriveTitle combines exception type and value", () => {
  assertEquals(deriveTitle(STACK_EVENT), "TypeError: Cannot read properties of undefined");
});

Deno.test("deriveTitle falls back to the message when there's no exception", () => {
  assertEquals(deriveTitle({ message: "disk full" }), "disk full");
});

Deno.test("deriveCulprit names the innermost in-app frame", () => {
  assertEquals(deriveCulprit(STACK_EVENT), "useCheckout");
});

Deno.test("deriveCulprit returns null when there's no stack trace", () => {
  assertEquals(deriveCulprit({ message: "disk full" }), null);
});
