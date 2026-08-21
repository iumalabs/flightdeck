import { assertEquals } from "@std/assert";
import {
  isEventItem,
  parseEnvelope,
  parseEventPayload,
} from "../../worker/modules/ingest/envelope.ts";

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

Deno.test("parseEnvelope parses a single-event envelope", () => {
  const payload = `{"message":"hello world"}`;
  const body = [
    `{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc"}`,
    `{"type":"event","length":${bytesOf(payload).length}}`,
    payload,
  ].join("\n");

  const parsed = parseEnvelope(bytesOf(body));
  assertEquals(parsed?.header.event_id, "9ec79c33ec9942ab8353589fcb2e04dc");
  assertEquals(parsed?.items.length, 1);
  assertEquals(isEventItem(parsed!.items[0]), true);
  assertEquals(parseEventPayload(parsed!.items[0]), { message: "hello world" });
});

Deno.test("parseEnvelope skips unrecognized item types using their length header", () => {
  const sessionPayload = `{"sid":"abc"}`;
  const eventPayload = `{"message":"hi"}`;
  const body = [
    `{"event_id":"x"}`,
    `{"type":"session","length":${bytesOf(sessionPayload).length}}`,
    sessionPayload,
    `{"type":"event","length":${bytesOf(eventPayload).length}}`,
    eventPayload,
  ].join("\n");

  const parsed = parseEnvelope(bytesOf(body));
  assertEquals(parsed?.items.length, 2);
  assertEquals(isEventItem(parsed!.items[0]), false);
  assertEquals(isEventItem(parsed!.items[1]), true);
  assertEquals(parseEventPayload(parsed!.items[1]), { message: "hi" });
});

Deno.test("parseEnvelope handles a header-only envelope with no items", () => {
  const parsed = parseEnvelope(bytesOf(`{"event_id":"x"}`));
  assertEquals(parsed?.items.length, 0);
});

Deno.test("parseEnvelope returns null for an unparseable header", () => {
  const parsed = parseEnvelope(bytesOf(`not json\n{"type":"event","length":2}\n{}`));
  assertEquals(parsed, null);
});

Deno.test("parseEnvelope returns null for a truncated body (length overruns)", () => {
  const body = [`{"event_id":"x"}`, `{"type":"event","length":9999}`, `{"message":"hi"}`].join(
    "\n",
  );
  const parsed = parseEnvelope(bytesOf(body));
  assertEquals(parsed, null);
});

Deno.test("parseEnvelope returns null for an item header with no terminating newline", () => {
  const body = `{"event_id":"x"}\n{"type":"event","length":2}`;
  const parsed = parseEnvelope(bytesOf(body));
  assertEquals(parsed, null);
});
