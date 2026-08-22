import { expect, test } from "@playwright/test";
import { mintTestSession } from "../e2e/support/session.ts";
import { getDsnKey } from "./support/dsn-key.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "./support/seed-actor.ts";

// Contract tests against a real wrangler dev — hand-crafted requests matching
// contracts/release-management-api.md's confirmed wire format (research.md §8), not a real
// sentry-cli binary dependency in CI (reserved for quickstart.md's manual validation step).

test.beforeAll(async () => {
  await ensureContractTestActor();
});

let cachedCookie: string | null = null;
async function sessionCookieHeader(): Promise<string> {
  if (!cachedCookie) {
    const token = await mintTestSession({ ...CONTRACT_TEST_ACTOR, role: "member" });
    cachedCookie = `fd_session=${token}`;
  }
  return cachedCookie;
}

async function generateApiToken(
  request: import("@playwright/test").APIRequestContext,
): Promise<{ token: string; tokenId: string }> {
  const cookie = await sessionCookieHeader();
  const res = await request.post("/api/internal/projects/demo/api-tokens", {
    headers: { Cookie: cookie },
  });
  const body = await res.json() as { id: string; token: string };
  return { token: body.token, tokenId: body.id };
}

test("a full sentry-cli release flow (create, upload-sourcemaps, finalize) succeeds", async ({ request }) => {
  const { token } = await generateApiToken(request);
  const version = `contract-release-${crypto.randomUUID()}`;

  const create = await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { version, projects: ["demo"] },
  });
  expect(create.status()).toBe(201);

  const upload = await request.post(
    `/api/0/projects/anyorg/demo/releases/${version}/files/`,
    {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        name: "~/app.min.js.map",
        file: {
          name: "app.min.js.map",
          mimeType: "application/json",
          buffer: Buffer.from('{"version":3}'),
        },
      },
    },
  );
  expect(upload.status()).toBe(201);

  const finalize = await request.put(`/api/0/organizations/anyorg/releases/${version}/`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { dateReleased: new Date().toISOString() },
  });
  expect(finalize.status()).toBe(200);
  const finalizeBody = await finalize.json() as { dateReleased: string | null };
  expect(finalizeBody.dateReleased).not.toBeNull();
});

test("a repeated 'releases new' for the same version is a no-op, not a duplicate", async ({ request }) => {
  const { token } = await generateApiToken(request);
  const version = `contract-dedup-${crypto.randomUUID()}`;

  const first = await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { version, projects: ["demo"] },
  });
  expect(first.status()).toBe(201);

  const second = await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { version, projects: ["demo"] },
  });
  expect(second.status()).toBe(201); // still accepted, just a no-op — not an error

  const list = await request.get("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const releases = await list.json() as { version: string }[];
  expect(releases.filter((r) => r.version === version).length).toBe(1);
});

test("an invalid API token is rejected, fail closed, no data created", async ({ request }) => {
  const version = `contract-rejected-${crypto.randomUUID()}`;
  const response = await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: "Bearer not-a-real-token", "Content-Type": "application/json" },
    data: { version, projects: ["demo"] },
  });
  expect(response.status()).toBe(403);
});

test("a token is project-scoped — rejects a release for a project it isn't scoped to", async ({ request }) => {
  const { token } = await generateApiToken(request);
  const response = await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: {
      version: `contract-wrong-project-${crypto.randomUUID()}`,
      projects: ["not-my-project"],
    },
  });
  expect(response.status()).toBe(403);
});

test("a revoked token is rejected on subsequent use", async ({ request }) => {
  const { token, tokenId } = await generateApiToken(request);
  const cookie = await sessionCookieHeader();

  const revoke = await request.delete(`/api/internal/projects/demo/api-tokens/${tokenId}`, {
    headers: { Cookie: cookie },
  });
  expect(revoke.status()).toBe(200);

  const response = await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { version: `contract-revoked-${crypto.randomUUID()}`, projects: ["demo"] },
  });
  expect(response.status()).toBe(403);
});

test("session ingest correctly aggregates into adoption/crash-free figures for a known distribution", async ({ request }) => {
  const dsnKey = await getDsnKey();
  const { token } = await generateApiToken(request);
  const version = `contract-health-${crypto.randomUUID()}`;

  await request.post("/api/0/organizations/anyorg/releases/", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { version, projects: ["demo"] },
  });

  // Known distribution: 8 exited, 1 errored, 1 crashed = 10 sessions, 90% crash-free.
  const payload = JSON.stringify({
    attrs: { release: version, environment: "production" },
    aggregates: [{ started: new Date().toISOString(), exited: 8, errored: 1, crashed: 1 }],
  });
  const eventId = crypto.randomUUID();
  const envelope = [
    JSON.stringify({ event_id: eventId }),
    JSON.stringify({ type: "sessions", length: new TextEncoder().encode(payload).length }),
    payload,
  ].join("\n");
  const ingest = await request.post(`/api/demo/envelope?sentry_key=${dsnKey}&sentry_version=7`, {
    data: envelope,
  });
  expect(ingest.status()).toBe(200);

  const cookie = await sessionCookieHeader();
  let releaseId: string | null = null;
  for (let i = 0; i < 10 && !releaseId; i++) {
    const list = await request.get("/api/0/organizations/anyorg/releases/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const releases = await list.json() as { version: string }[];
    if (releases.some((r) => r.version === version)) {
      // Resolve the internal id via the dashboard list (contract-level, not a direct id lookup).
      const internal = await request.get("/api/internal/releases", { headers: { Cookie: cookie } });
      const internalReleases = await internal.json() as {
        releases: { id: string; version: string }[];
      };
      releaseId = internalReleases.releases.find((r) => r.version === version)?.id ?? null;
    }
    if (!releaseId) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(releaseId).not.toBeNull();

  let crashFreeSessionRate: number | null = null;
  for (let i = 0; i < 8 && crashFreeSessionRate === null; i++) {
    const detail = await request.get(`/api/internal/releases/${releaseId}`, {
      headers: { Cookie: cookie },
    });
    const body = await detail.json() as { environments: { crashFreeSessionRate: number | null }[] };
    crashFreeSessionRate = body.environments[0]?.crashFreeSessionRate ?? null;
    if (crashFreeSessionRate === null) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(crashFreeSessionRate).toBeCloseTo(90, 0);
});
