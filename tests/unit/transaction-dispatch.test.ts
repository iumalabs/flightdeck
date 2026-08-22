import { assertEquals } from "@std/assert";
import {
  isEventItem,
  isTransactionItem,
  parseEnvelope,
  parseTransactionPayload,
} from "../../worker/modules/ingest/envelope.ts";
import { computeDurationMs } from "../../worker/modules/ingest/trace-consumer.ts";

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

Deno.test("isTransactionItem/isEventItem correctly separate item types in one envelope", () => {
  const eventPayload = `{"message":"hi"}`;
  const txnPayload = `{"type":"transaction","start_timestamp":1,"timestamp":2}`;
  const body = [
    `{"event_id":"x"}`,
    `{"type":"event","length":${bytesOf(eventPayload).length}}`,
    eventPayload,
    `{"type":"transaction","length":${bytesOf(txnPayload).length}}`,
    txnPayload,
  ].join("\n");

  const parsed = parseEnvelope(bytesOf(body));
  assertEquals(parsed?.items.length, 2);
  assertEquals(isEventItem(parsed!.items[0]), true);
  assertEquals(isTransactionItem(parsed!.items[0]), false);
  assertEquals(isEventItem(parsed!.items[1]), false);
  assertEquals(isTransactionItem(parsed!.items[1]), true);
  assertEquals(parseTransactionPayload(parsed!.items[1]), {
    type: "transaction",
    start_timestamp: 1,
    timestamp: 2,
  });
});

Deno.test("computeDurationMs computes from timestamp - start_timestamp, including fractional seconds", () => {
  assertEquals(computeDurationMs(1735689600.0, 1735689600.842), 842);
  assertEquals(computeDurationMs(1735689600.1, 1735689600.3), 200);
});

Deno.test("computeDurationMs never returns negative for out-of-order timestamps", () => {
  assertEquals(computeDurationMs(10, 9), 0);
});

Deno.test("computeDurationMs handles a zero-duration transaction", () => {
  assertEquals(computeDurationMs(5, 5), 0);
});
