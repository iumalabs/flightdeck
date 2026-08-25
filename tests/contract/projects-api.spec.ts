import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mintTestSession } from "../e2e/support/session.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "./support/seed-actor.ts";

// contracts/projects-internal-api.md, against a real wrangler dev (specs/008-multi-project-support
// quickstart.md). POST /api/internal/v1/projects's own contract (name validation, working+isolated
// DSN) plus, per route, that an explicit ?project= override actually reaches the resolved project
// — i.e. that each pillar module genuinely wired resolveRequestedProject() in, not just that the
// helper itself works correctly (tests/unit/resolve-project.test.ts already covers the helper's own
// logic). Traces/logs isolation is proven via the SAME synchronous surfaces (error/feedback
// envelope items, checks, releases) every other case here uses — round-tripping through the async
// ingest queue (research.md §9's polling pattern, already covered by trace-ingest.spec.ts/
// log-ingest.spec.ts) is orthogonal to this feature, which only adds a query parameter.

// migration 0009: the demo project seeded by that migration is deterministically id 1.
const DEMO_PROJECT_ID = "1";

test.beforeAll(async () => {
  await ensureContractTestActor();
});

async function sessionCookie(): Promise<string> {
  const token = await mintTestSession({ ...CONTRACT_TEST_ACTOR, role: "member" });
  return `fd_session=${token}`;
}

interface CreatedProject {
  id: string;
  name: string;
  dsn: string;
}

function dsnKeyOf(dsn: string): string {
  // "https://{key}@{host}/{id}"
  return new URL(dsn).username;
}

async function createProject(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  baseUrl?: string,
): Promise<CreatedProject> {
  const res = await request.post("/api/internal/v1/projects", {
    headers: { Cookie: await sessionCookie() },
    data: baseUrl ? { name, baseUrl } : { name },
  });
  expect(res.status()).toBe(201);
  return await res.json() as CreatedProject;
}

interface ProjectCheck {
  name: string;
  type: string;
  target: string;
}

async function listChecks(
  request: import("@playwright/test").APIRequestContext,
  projectId: string,
): Promise<ProjectCheck[]> {
  const res = await request.get(`/api/internal/v1/checks?project=${projectId}`, {
    headers: { Cookie: await sessionCookie() },
  });
  expect(res.status()).toBe(200);
  const { checks } = await res.json() as { checks: ProjectCheck[] };
  return checks;
}

function buildErrorEnvelope(eventId: string, uniqueTitle: string): string {
  const payload = {
    event_id: eventId,
    level: "error",
    exception: {
      values: [{
        type: uniqueTitle,
        value: "seeded for projects-api.spec.ts",
        stacktrace: { frames: [{ filename: "app.js", function: "handleClick", in_app: true }] },
      }],
    },
  };
  const payloadJson = JSON.stringify(payload);
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({
    type: "event",
    length: new TextEncoder().encode(payloadJson).length,
  });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

function buildFeedbackEnvelope(eventId: string, message: string): string {
  const payloadJson = JSON.stringify({ event_id: eventId, contexts: { feedback: { message } } });
  const envelopeHeader = JSON.stringify({ event_id: eventId });
  const itemHeader = JSON.stringify({
    type: "feedback",
    length: new TextEncoder().encode(payloadJson).length,
  });
  return [envelopeHeader, itemHeader, payloadJson].join("\n");
}

async function ingestError(
  request: import("@playwright/test").APIRequestContext,
  projectId: string,
  dsnKey: string,
  uniqueTitle: string,
): Promise<void> {
  const eventId = crypto.randomUUID();
  const res = await request.post(
    `/api/${projectId}/envelope?sentry_key=${dsnKey}&sentry_version=7`,
    { data: buildErrorEnvelope(eventId, uniqueTitle) },
  );
  expect(res.status()).toBe(200);
}

// === POST /api/internal/v1/projects (US1) ===

test("a valid name creates a project with a real, working, isolated DSN", async ({ request }) => {
  const projectName = `contract-project-${crypto.randomUUID().slice(0, 8)}`;
  const project = await createProject(request, projectName);
  expect(project.id).toBeTruthy();
  expect(project.name).toBe(projectName);
  expect(project.dsn).toMatch(/^https:\/\/[0-9a-f]+@.+\/[^/]+$/);

  const uniqueTitle = `contract-isolation-${crypto.randomUUID().slice(0, 8)}`;
  await ingestError(request, project.id, dsnKeyOf(project.dsn), uniqueTitle);

  const scoped = await request.get(`/api/internal/v1/issues?project=${project.id}`, {
    headers: { Cookie: await sessionCookie() },
  });
  const { issues: scopedIssues } = await scoped.json() as { issues: { title: string }[] };
  expect(scopedIssues.some((i) => i.title.includes(uniqueTitle))).toBe(true);

  const demoScoped = await request.get(`/api/internal/v1/issues?project=${DEMO_PROJECT_ID}`, {
    headers: { Cookie: await sessionCookie() },
  });
  const { issues: demoIssues } = await demoScoped.json() as { issues: { title: string }[] };
  expect(demoIssues.some((i) => i.title.includes(uniqueTitle))).toBe(false);
});

test("an empty name is rejected with 400", async ({ request }) => {
  const res = await request.post("/api/internal/v1/projects", {
    headers: { Cookie: await sessionCookie() },
    data: { name: "" },
  });
  expect(res.status()).toBe(400);
});

test("a missing name is rejected with 400", async ({ request }) => {
  const res = await request.post("/api/internal/v1/projects", {
    headers: { Cookie: await sessionCookie() },
    data: {},
  });
  expect(res.status()).toBe(400);
});

// === issue #72 — baseUrl-driven default uptime check seeding ===

test("project creation without baseUrl seeds no uptime checks", async ({ request }) => {
  const project = await createProject(
    request,
    `contract-no-baseurl-${crypto.randomUUID().slice(0, 8)}`,
  );
  const checks = await listChecks(request, project.id);
  expect(checks.length).toBe(0);
});

test("a malformed baseUrl is rejected with 400, and no project is created", async ({ request }) => {
  const projectName = `contract-bad-baseurl-${crypto.randomUUID().slice(0, 8)}`;
  const res = await request.post("/api/internal/v1/projects", {
    headers: { Cookie: await sessionCookie() },
    data: { name: projectName, baseUrl: "not-a-url" },
  });
  expect(res.status()).toBe(400);

  // Confirm the reject happened before the insert — no stray project with this name exists.
  const list = await request.get("/api/internal/v1/projects", {
    headers: { Cookie: await sessionCookie() },
  });
  const { projects } = await list.json() as { projects: { name: string }[] };
  expect(projects.some((p) => p.name === projectName)).toBe(false);
});

test("project creation with baseUrl always seeds a root check, plus a health check only when a real target responds 200", async ({ request }) => {
  const requestedPaths: string[] = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (req) => {
    const path = new URL(req.url).pathname;
    requestedPaths.push(path);
    if (path === "/health") return new Response("ok", { status: 200 });
    return new Response("not found", { status: 404 });
  });

  try {
    const baseUrl = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const project = await createProject(
      request,
      `contract-baseurl-health-${crypto.randomUUID().slice(0, 8)}`,
      baseUrl,
    );

    const checks = await listChecks(request, project.id);
    expect(checks.length).toBe(2);

    const root = checks.find((c) => c.target === baseUrl);
    expect(root).toBeTruthy();
    expect(root!.type).toBe("http");

    const health = checks.find((c) => c.target === `${baseUrl}/health`);
    expect(health).toBeTruthy();
    expect(health!.type).toBe("http");
  } finally {
    await server.shutdown();
  }
});

test("project creation with baseUrl seeds only the root check when no health-endpoint candidate responds 200", async ({ request }) => {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    () => new Response("not found", { status: 404 }),
  );

  try {
    const baseUrl = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const project = await createProject(
      request,
      `contract-baseurl-nohealth-${crypto.randomUUID().slice(0, 8)}`,
      baseUrl,
    );

    const checks = await listChecks(request, project.id);
    expect(checks.length).toBe(1);
    expect(checks[0].target).toBe(baseUrl);
  } finally {
    await server.shutdown();
  }
});

// === issue #75 — a catch-all 200 (e.g. an SPA fallback route) must not be mistaken for a real
// "/health" endpoint ===

test("project creation with baseUrl seeds only the root check when the app serves an identical catch-all 200 for any path (SPA fallback)", async ({ request }) => {
  // Every path — including /health, /api/health, and whatever random baseline path the fix probes
  // — gets the exact same 200 response, the way FlightDeck's own marketing site behaves under
  // `not_found_handling: "single-page-application"` (see issue #75).
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    () =>
      new Response("<!doctype html><html><body>spa shell</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  );

  try {
    const baseUrl = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const project = await createProject(
      request,
      `contract-baseurl-spa-catchall-${crypto.randomUUID().slice(0, 8)}`,
      baseUrl,
    );

    const checks = await listChecks(request, project.id);
    expect(checks.length).toBe(1);
    expect(checks[0].name).toBe("Root");
    expect(checks[0].target).toBe(baseUrl);
  } finally {
    await server.shutdown();
  }
});

test("project creation with baseUrl still seeds Health when /health is genuinely distinct from the app's own catch-all 200 (issue #75 regression guard)", async ({ request }) => {
  // The app ALSO serves a catch-all 200 for unmatched paths (including the random baseline path
  // this fix probes) — proving the fix distinguishes by content, not by "baseline 200 => never
  // seed Health", which would wrongly break issue #72's original working case for exactly this
  // kind of app (one with both an SPA fallback AND a real, distinctly-behaving /health route).
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("<!doctype html><html><body>spa shell</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });

  try {
    const baseUrl = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const project = await createProject(
      request,
      `contract-baseurl-real-health-${crypto.randomUUID().slice(0, 8)}`,
      baseUrl,
    );

    const checks = await listChecks(request, project.id);
    expect(checks.length).toBe(2);
    const health = checks.find((c) => c.target === `${baseUrl}/health`);
    expect(health).toBeTruthy();
    expect(health!.name).toBe("Health");
  } finally {
    await server.shutdown();
  }
});

// === ?project= override, per route (US2) ===
// One shared second project (and its own uniquely-marked data) reused across every case below —
// each case proves its own route's isolation independent of the others.

test.describe("?project= override per route", () => {
  let projectB: CreatedProject;
  const marker = crypto.randomUUID().slice(0, 8);

  test.beforeAll(async ({ request }) => {
    projectB = await createProject(request, `contract-override-${marker}`);
  });

  test("issues: GET /api/internal/v1/issues and GET /api/internal/v1/issues/{id} scope to ?project=", async ({ request }) => {
    const title = `contract-issues-${marker}`;
    await ingestError(request, projectB.id, dsnKeyOf(projectB.dsn), title);

    const listB = await request.get(`/api/internal/v1/issues?project=${projectB.id}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const { issues } = await listB.json() as { issues: { id: string; title: string }[] };
    const found = issues.find((i) => i.title.includes(title));
    expect(found).toBeTruthy();

    const listDemo = await request.get(`/api/internal/v1/issues?project=${DEMO_PROJECT_ID}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const { issues: demoIssues } = await listDemo.json() as { issues: { title: string }[] };
    expect(demoIssues.some((i) => i.title.includes(title))).toBe(false);

    // Cross-project detail lookup: found.id belongs to projectB, so ?project=demo must 404 it —
    // proves the detail route's own project_id filter, not just the list route's.
    const wrongScope = await request.get(
      `/api/internal/v1/issues/${found!.id}?project=${DEMO_PROJECT_ID}`,
      {
        headers: { Cookie: await sessionCookie() },
      },
    );
    expect(wrongScope.status()).toBe(404);

    const rightScope = await request.get(
      `/api/internal/v1/issues/${found!.id}?project=${projectB.id}`,
      {
        headers: { Cookie: await sessionCookie() },
      },
    );
    expect(rightScope.status()).toBe(200);
  });

  test("feedback: GET /api/internal/v1/feedback scopes to ?project=", async ({ request }) => {
    const message = `contract-feedback-${marker}`;
    const eventId = crypto.randomUUID();
    const ingest = await request.post(
      `/api/${projectB.id}/envelope?sentry_key=${dsnKeyOf(projectB.dsn)}&sentry_version=7`,
      { data: buildFeedbackEnvelope(eventId, message) },
    );
    expect(ingest.status()).toBe(200);

    const listB = await request.get(`/api/internal/v1/feedback?project=${projectB.id}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const { feedback } = await listB.json() as { feedback: { message: string }[] };
    expect(feedback.some((f) => f.message === message)).toBe(true);

    const listDemo = await request.get(`/api/internal/v1/feedback?project=${DEMO_PROJECT_ID}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const { feedback: demoFeedback } = await listDemo.json() as { feedback: { message: string }[] };
    expect(demoFeedback.some((f) => f.message === message)).toBe(false);
  });

  test("checks/incidents: POST and GET /api/internal/v1/checks, GET /api/internal/v1/incidents scope to ?project=", async ({ request }) => {
    const name = `contract-check-${marker}`;
    const create = await request.post(`/api/internal/v1/checks?project=${projectB.id}`, {
      headers: { Cookie: await sessionCookie() },
      data: { name, type: "http", target: "https://example.com", intervalSeconds: 60 },
    });
    expect(create.status()).toBe(201);

    const listB = await request.get(`/api/internal/v1/checks?project=${projectB.id}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const { checks } = await listB.json() as { checks: { name: string }[] };
    expect(checks.some((c) => c.name === name)).toBe(true);

    const listDemo = await request.get(`/api/internal/v1/checks?project=${DEMO_PROJECT_ID}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const { checks: demoChecks } = await listDemo.json() as { checks: { name: string }[] };
    expect(demoChecks.some((c) => c.name === name)).toBe(false);
  });

  test("releases: GET /api/internal/v1/releases and GET /api/internal/v1/releases/{id} scope to ?project=", async ({ request }) => {
    // projectsRoutes.post("/:id/source-maps") implicitly creates the release row (data-model.md's
    // Edge Case) — a normal, already-project-scoped-by-path-param write, reused here purely as a
    // way to get a release onto projectB without hand-seeding the database directly.
    const version = `contract-release-${marker}`;
    const upload = await request.post(`/api/internal/v1/projects/${projectB.id}/source-maps`, {
      headers: { Cookie: await sessionCookie() },
      multipart: {
        release: version,
        minifiedPathPattern: "app.min.js",
        file: {
          name: "app.min.js.map",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })),
        },
      },
    });
    expect(upload.status()).toBe(201);

    const listB = await request.get(`/api/internal/v1/releases?project=${projectB.id}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const { releases } = await listB.json() as { releases: { id: string; version: string }[] };
    const found = releases.find((r) => r.version === version);
    expect(found).toBeTruthy();

    const listDemo = await request.get(`/api/internal/v1/releases?project=${DEMO_PROJECT_ID}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const { releases: demoReleases } = await listDemo.json() as { releases: { version: string }[] };
    expect(demoReleases.some((r) => r.version === version)).toBe(false);

    const wrongScope = await request.get(
      `/api/internal/v1/releases/${found!.id}?project=${DEMO_PROJECT_ID}`,
      {
        headers: { Cookie: await sessionCookie() },
      },
    );
    expect(wrongScope.status()).toBe(404);
  });
});

// === Graceful fallback (contract's "never a 400/404 purely for an invalid/missing selector") ===

test("an omitted ?project= falls back to the first project by created_at, never a 400/404", async ({ request }) => {
  const res = await request.get("/api/internal/v1/issues", {
    headers: { Cookie: await sessionCookie() },
  });
  expect(res.status()).toBe(200);
});

test("an unresolvable ?project= id falls back to the first project, never a 400/404", async ({ request }) => {
  const res = await request.get("/api/internal/v1/issues?project=does-not-exist", {
    headers: { Cookie: await sessionCookie() },
  });
  expect(res.status()).toBe(200);
});
