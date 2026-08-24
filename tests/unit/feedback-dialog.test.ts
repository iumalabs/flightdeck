import { assertEquals, assertMatch, assertStrictEquals } from "@std/assert";
import {
  buildDialogScript,
  handleDialogGet,
  handleDialogPost,
  parseDsn,
} from "../../worker/modules/feedback/dialog.ts";

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

const NO_PREFILL = { name: null, email: null };

Deno.test("buildDialogScript embeds the exact submit URL (query string preserved)", () => {
  const script = buildDialogScript(
    "/api/embed/error-page?dsn=https://k@h/p&eventId=e1",
    NO_PREFILL,
  );
  assertMatch(
    script,
    /fetch\("\/api\/embed\/error-page\?dsn=https:\/\/k@h\/p&eventId=e1"/,
  );
});

Deno.test("buildDialogScript wires the confirmed real-SDK onClose postMessage contract", () => {
  const script = buildDialogScript("/api/embed/error-page?dsn=x&eventId=y", NO_PREFILL);
  assertMatch(script, /postMessage\("__sentry_reportdialog_closed__"/);
});

// T030 (specs/007-user-feedback Phase 7 Convergence, contracts/feedback-ingest-api.md's
// documented GET contract) — the dialog GET's optional name/email prefill values.

Deno.test("buildDialogScript sets form.name.value/form.email.value from the given prefill", () => {
  const script = buildDialogScript("/api/embed/error-page?dsn=x&eventId=y", {
    name: "Jane Doe",
    email: "jane@example.com",
  });
  assertMatch(script, /form\.name\.value = "Jane Doe";/);
  assertMatch(script, /form\.email\.value = "jane@example\.com";/);
});

Deno.test("buildDialogScript defaults absent prefill values to an empty string, not the literal 'null'", () => {
  const script = buildDialogScript("/api/embed/error-page?dsn=x&eventId=y", NO_PREFILL);
  assertMatch(script, /form\.name\.value = "";/);
  assertMatch(script, /form\.email\.value = "";/);
});

Deno.test("buildDialogScript safely escapes a prefill value containing quotes/HTML — no injection into the generated script", () => {
  const malicious = '"; alert(1); var x="';
  const script = buildDialogScript("/api/embed/error-page?dsn=x&eventId=y", {
    name: malicious,
    email: null,
  });
  // JSON.stringify's escaping means the hostile input appears only as an escaped string literal
  // payload, never as executable syntax breaking out of the assignment.
  assertMatch(script, /form\.name\.value = "\\"; alert\(1\); var x=\\"";/);
  // The exact unescaped injection string must never appear as literal, executable-looking syntax.
  assertEquals(script.includes('form.name.value = "";alert(1)'), false);
});

// Fakes for handleDialogGet/handleDialogPost's rate-limit (tasks.md T028) and payload-size
// (T029) guards — same minimal-fake pattern as tests/unit/dsn-auth.test.ts's FakeD1.

// Throws if queried at all — proves the 429/413 rejections below return BEFORE any D1 call,
// mirroring the envelope path's "fail closed with no DB/DO call" ordering
// (worker/modules/ingest/routes.ts).
class UnreachableD1 {
  prepare(): never {
    throw new Error("D1 should not be queried when the request is rejected before that point");
  }
}

function fakeRateLimiter(result: { allowed: boolean; retryAfterSeconds: number }) {
  return {
    idFromName: (name: string) => name,
    get: (_id: string) => ({ checkAndIncrement: () => Promise.resolve(result) }),
  };
}

// Throws if checkAndIncrement is ever called — proves the size guard (T029) rejects an oversized
// POST before spending a rate-limit DO call.
function unreachableRateLimiter() {
  return {
    idFromName: (name: string) => name,
    get: (_id: string) => ({
      checkAndIncrement: () => {
        throw new Error("RATE_LIMITER should not be called before the size guard rejects");
      },
    }),
  };
}

type DialogEnv = Parameters<typeof handleDialogGet>[1];

const VALID_DSN = "https://abc123@127.0.0.1:8787/demo";

Deno.test("handleDialogGet returns 429 with X-Sentry-Rate-Limits when the DSN key's budget is exhausted", async () => {
  const request = new Request(
    `https://flightdeck.iuma.dev/api/embed/error-page?dsn=${
      encodeURIComponent(VALID_DSN)
    }&eventId=evt-1`,
  );
  const env = {
    DB: new UnreachableD1(),
    RATE_LIMITER: fakeRateLimiter({ allowed: false, retryAfterSeconds: 42 }),
  } as unknown as DialogEnv;

  const res = await handleDialogGet(request, env);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get("X-Sentry-Rate-Limits"), "42::key");
});

Deno.test("handleDialogPost returns 429 with X-Sentry-Rate-Limits when the DSN key's budget is exhausted", async () => {
  const body = new URLSearchParams({
    name: "Jane",
    email: "jane@example.com",
    comments: "it broke",
  });
  const request = new Request(
    `https://flightdeck.iuma.dev/api/embed/error-page?dsn=${
      encodeURIComponent(VALID_DSN)
    }&eventId=evt-1`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
  const env = {
    DB: new UnreachableD1(),
    RATE_LIMITER: fakeRateLimiter({ allowed: false, retryAfterSeconds: 7 }),
  } as unknown as DialogEnv;

  const res = await handleDialogPost(request, env);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get("X-Sentry-Rate-Limits"), "7::key");
});

Deno.test("handleDialogPost rejects an oversized body with 413 before touching the rate limiter or DB", async () => {
  const oversized = "x".repeat(70_000); // > MAX_DIALOG_FORM_BYTES (64 KB)
  const body = new URLSearchParams({
    name: "Jane",
    email: "jane@example.com",
    comments: oversized,
  });
  const request = new Request(
    `https://flightdeck.iuma.dev/api/embed/error-page?dsn=${
      encodeURIComponent(VALID_DSN)
    }&eventId=evt-1`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
  const env = {
    DB: new UnreachableD1(),
    RATE_LIMITER: unreachableRateLimiter(),
  } as unknown as DialogEnv;

  const res = await handleDialogPost(request, env);
  assertEquals(res.status, 413);
});
