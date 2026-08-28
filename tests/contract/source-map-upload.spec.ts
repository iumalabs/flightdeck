import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mintTestSession } from "../e2e/support/session.ts";
import { getDsnKey } from "./support/dsn-key.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "./support/seed-actor.ts";

test.beforeAll(async () => {
  await ensureContractTestActor();
});

// contracts/internal-api.md's POST /api/internal/v1/projects/{id}/source-maps, against a real
// wrangler dev (research.md §7) — this is also T027's spike proof for @jridgewell/trace-mapping:
// the upload here plus tests/unit/sourcemap-resolve.test.ts's resolution logic only differ by
// which JS runtime the library executes in (Deno test vs. this suite's actual Workers/workerd
// instance), and both pass.

// migration 0009: the demo project seeded by that migration is deterministically id 1.
const DEMO_PROJECT_ID = "1";

// A real Source Map v3 fixture, same as tests/unit/sourcemap-resolve.test.ts's — mappings
// "AAAAA" decodes to: generated (line 1, col 0) -> sources[0]="app.js", original (line 1, col 0),
// names[0]="render".
const REAL_SOURCE_MAP = JSON.stringify({
  version: 3,
  sources: ["app.js"],
  names: ["render"],
  mappings: "AAAAA",
});

async function sessionCookie(): Promise<string> {
  const token = await mintTestSession({ ...CONTRACT_TEST_ACTOR, role: "member" });
  return `fd_session=${token}`;
}

test("uploading a source map for a not-yet-seen release implicitly creates the release", async ({ request }) => {
  const release = `contract-test-${crypto.randomUUID()}`;
  const response = await request.post(`/api/internal/v1/projects/${DEMO_PROJECT_ID}/source-maps`, {
    headers: { Cookie: await sessionCookie() },
    multipart: {
      release,
      minifiedPathPattern: "app.min.js",
      file: {
        name: "app.min.js.map",
        mimeType: "application/json",
        buffer: Buffer.from(REAL_SOURCE_MAP),
      },
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(typeof body.id).toBe("string");
});

test("an uploaded map is actually used to resolve a subsequently ingested event's stack trace", async ({ request }) => {
  const release = `contract-test-${crypto.randomUUID()}`;
  const eventId = crypto.randomUUID();
  // Resolution runs before fingerprinting (research.md §5), so the resolved function name IS part
  // of the issue's identity — a fixed name here would collide with every other run of this test
  // against the same fingerprint, updating an existing issue's event_count instead of creating a
  // fresh one this test can unambiguously look up by title.
  const resolvedName = `render_${eventId}`;
  const sourceMap = JSON.stringify({
    version: 3,
    sources: ["app.js"],
    names: [resolvedName],
    mappings: "AAAAA",
  });

  const upload = await request.post(`/api/internal/v1/projects/${DEMO_PROJECT_ID}/source-maps`, {
    headers: { Cookie: await sessionCookie() },
    multipart: {
      release,
      minifiedPathPattern: "app.min.js",
      file: {
        name: "app.min.js.map",
        mimeType: "application/json",
        buffer: Buffer.from(sourceMap),
      },
    },
  });
  expect(upload.status()).toBe(201);

  const dsnKey = await getDsnKey();

  const uniqueMessage = `boom-${eventId}`;
  const eventJson = JSON.stringify({
    event_id: eventId,
    release,
    exception: {
      values: [{
        type: "TypeError",
        value: uniqueMessage,
        stacktrace: { frames: [{ filename: "app.min.js", function: "n", lineno: 1, colno: 0 }] },
      }],
    },
  });
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({
    type: "event",
    length: new TextEncoder().encode(eventJson).length,
  });
  const body = [envelopeHeader, itemHeader, eventJson].join("\n");

  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(ingest.status()).toBe(200);

  const issues = await request.get(`/api/internal/v1/issues`, {
    headers: { Cookie: await sessionCookie() },
  });
  const { issues: issueList } = await issues.json();
  const issue = issueList.find((i: { title: string }) => i.title.includes(uniqueMessage));
  expect(issue).toBeTruthy();

  const detail = await request.get(`/api/internal/v1/issues/${issue.id}`, {
    headers: { Cookie: await sessionCookie() },
  });
  const detailBody = await detail.json();
  const frame = detailBody.latestEvent.stacktrace.frames[0];
  expect(frame.resolved).toBe(true);
  expect(frame.filename).toBe("app.js");
  expect(frame.function).toBe(resolvedName);
});

// issue #125's exact repro: a malformed/non-JSON uploaded source map must not permanently 500
// every subsequent event that references it — the event should ingest successfully, with that
// frame simply unresolved.
test("an event referencing a malformed (non-JSON) uploaded source map ingests successfully with the frame unresolved", async ({ request }) => {
  const release = `contract-test-${crypto.randomUUID()}`;
  const eventId = crypto.randomUUID();

  const upload = await request.post(`/api/internal/v1/projects/${DEMO_PROJECT_ID}/source-maps`, {
    headers: { Cookie: await sessionCookie() },
    multipart: {
      release,
      minifiedPathPattern: "app.min.js",
      file: {
        name: "app.min.js.map",
        mimeType: "application/json",
        buffer: Buffer.from("this is not json"),
      },
    },
  });
  expect(upload.status()).toBe(201);

  const dsnKey = await getDsnKey();
  const uniqueMessage = `boom-malformed-map-${eventId}`;
  // The frame stays unresolved (source map load fails), so unlike the "uploaded map is used"
  // test above, the fingerprint's stack signature comes straight from this frame rather than a
  // resolved original name — embedding eventId in `function` keeps it unique per run so this
  // event lands on a fresh issue instead of colliding with another test's generic
  // app.min.js/n-shaped unresolved frame (issue grouping doesn't update an existing issue's
  // title on a fingerprint match, only its counters).
  const minifiedFunction = `n_${eventId}`;
  const eventJson = JSON.stringify({
    event_id: eventId,
    release,
    exception: {
      values: [{
        type: "TypeError",
        value: uniqueMessage,
        stacktrace: {
          frames: [{ filename: "app.min.js", function: minifiedFunction, lineno: 1, colno: 0 }],
        },
      }],
    },
  });
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({
    type: "event",
    length: new TextEncoder().encode(eventJson).length,
  });
  const body = [envelopeHeader, itemHeader, eventJson].join("\n");

  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(ingest.status()).toBe(200);

  const issues = await request.get(`/api/internal/v1/issues`, {
    headers: { Cookie: await sessionCookie() },
  });
  const { issues: issueList } = await issues.json();
  const issue = issueList.find((i: { title: string }) => i.title.includes(uniqueMessage));
  expect(issue).toBeTruthy();

  const detail = await request.get(`/api/internal/v1/issues/${issue.id}`, {
    headers: { Cookie: await sessionCookie() },
  });
  const detailBody = await detail.json();
  const frame = detailBody.latestEvent.stacktrace.frames[0];
  expect(frame.resolved).toBe(false);
  expect(frame.filename).toBe("app.min.js");
});

// contracts/internal-api.md's DELETE /api/internal/v1/projects/{id}/source-maps/{sourceMapId}
// (issue #125) — a bad upload can be removed, and a corrected re-upload for the same
// release/minifiedPathPattern then resolves correctly.
test("deleting a source map removes it, and a corrected re-upload then resolves correctly", async ({ request }) => {
  const release = `contract-test-${crypto.randomUUID()}`;
  const eventId = crypto.randomUUID();
  const resolvedName = `render_${eventId}`;

  const badUpload = await request.post(
    `/api/internal/v1/projects/${DEMO_PROJECT_ID}/source-maps`,
    {
      headers: { Cookie: await sessionCookie() },
      multipart: {
        release,
        minifiedPathPattern: "app.min.js",
        file: {
          name: "app.min.js.map",
          mimeType: "application/json",
          buffer: Buffer.from("this is not json"),
        },
      },
    },
  );
  expect(badUpload.status()).toBe(201);
  const { id: badSourceMapId } = await badUpload.json();

  const del = await request.delete(
    `/api/internal/v1/projects/${DEMO_PROJECT_ID}/source-maps/${badSourceMapId}`,
    { headers: { Cookie: await sessionCookie() } },
  );
  expect(del.status()).toBe(200);

  // Deleting the same id again is now a 404 — the row is actually gone, not merely flagged.
  const redel = await request.delete(
    `/api/internal/v1/projects/${DEMO_PROJECT_ID}/source-maps/${badSourceMapId}`,
    { headers: { Cookie: await sessionCookie() } },
  );
  expect(redel.status()).toBe(404);

  const goodSourceMap = JSON.stringify({
    version: 3,
    sources: ["app.js"],
    names: [resolvedName],
    mappings: "AAAAA",
  });
  const goodUpload = await request.post(
    `/api/internal/v1/projects/${DEMO_PROJECT_ID}/source-maps`,
    {
      headers: { Cookie: await sessionCookie() },
      multipart: {
        release,
        minifiedPathPattern: "app.min.js",
        file: {
          name: "app.min.js.map",
          mimeType: "application/json",
          buffer: Buffer.from(goodSourceMap),
        },
      },
    },
  );
  expect(goodUpload.status()).toBe(201);

  const dsnKey = await getDsnKey();
  const uniqueMessage = `boom-redelivered-${eventId}`;
  const eventJson = JSON.stringify({
    event_id: eventId,
    release,
    exception: {
      values: [{
        type: "TypeError",
        value: uniqueMessage,
        stacktrace: { frames: [{ filename: "app.min.js", function: "n", lineno: 1, colno: 0 }] },
      }],
    },
  });
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({
    type: "event",
    length: new TextEncoder().encode(eventJson).length,
  });
  const body = [envelopeHeader, itemHeader, eventJson].join("\n");

  const ingest = await request.post(
    `/api/${DEMO_PROJECT_ID}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: body },
  );
  expect(ingest.status()).toBe(200);

  const issues = await request.get(`/api/internal/v1/issues`, {
    headers: { Cookie: await sessionCookie() },
  });
  const { issues: issueList } = await issues.json();
  const issue = issueList.find((i: { title: string }) => i.title.includes(uniqueMessage));
  expect(issue).toBeTruthy();

  const detail = await request.get(`/api/internal/v1/issues/${issue.id}`, {
    headers: { Cookie: await sessionCookie() },
  });
  const detailBody = await detail.json();
  const frame = detailBody.latestEvent.stacktrace.frames[0];
  expect(frame.resolved).toBe(true);
  expect(frame.filename).toBe("app.js");
  expect(frame.function).toBe(resolvedName);
});

test("deleting a source map that doesn't exist returns 404", async ({ request }) => {
  const del = await request.delete(
    `/api/internal/v1/projects/${DEMO_PROJECT_ID}/source-maps/${crypto.randomUUID()}`,
    { headers: { Cookie: await sessionCookie() } },
  );
  expect(del.status()).toBe(404);
});
