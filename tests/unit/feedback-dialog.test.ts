import { assertEquals, assertMatch, assertStrictEquals } from "@std/assert";
import { buildDialogScript, parseDsn } from "../../worker/modules/feedback/dialog.ts";

Deno.test("parseDsn extracts the public key and project id from a full DSN string", () => {
  const parsed = parseDsn("https://abc123@127.0.0.1:8787/demo");
  assertEquals(parsed, { publicKey: "abc123", projectId: "demo" });
});

Deno.test("parseDsn returns null for a malformed DSN string", () => {
  assertStrictEquals(parseDsn("not-a-url"), null);
});

Deno.test("parseDsn returns null when the public key (username) is missing", () => {
  assertStrictEquals(parseDsn("https://127.0.0.1:8787/demo"), null);
});

Deno.test("parseDsn returns null when the project id (path) is missing", () => {
  assertStrictEquals(parseDsn("https://abc123@127.0.0.1:8787/"), null);
});

Deno.test("buildDialogScript embeds the exact submit URL (query string preserved)", () => {
  const script = buildDialogScript("/api/embed/error-page?dsn=https://k@h/p&eventId=e1");
  assertMatch(
    script,
    /fetch\("\/api\/embed\/error-page\?dsn=https:\/\/k@h\/p&eventId=e1"/,
  );
});

Deno.test("buildDialogScript wires the confirmed real-SDK onClose postMessage contract", () => {
  const script = buildDialogScript("/api/embed/error-page?dsn=x&eventId=y");
  assertMatch(script, /postMessage\("__sentry_reportdialog_closed__"/);
});
