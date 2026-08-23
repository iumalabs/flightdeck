import { expect, test } from "@playwright/test";
import { mintTestSession } from "../e2e/support/session.ts";
import { CONTRACT_TEST_ACTOR, ensureContractTestActor } from "./support/seed-actor.ts";

// Contract tests against a real wrangler dev (specs/006-uptime-monitoring quickstart.md) —
// exercises check creation, manual trigger (constitution Principle V's shared runCheck()), and
// incident-aware alerting through the real dashboard API, matching the established pattern from
// Modules 2-5's own contract suites.

let cachedCookie: string | null = null;
async function sessionCookieHeader(): Promise<string> {
  await ensureContractTestActor();
  if (!cachedCookie) {
    const token = await mintTestSession({
      sub: CONTRACT_TEST_ACTOR.sub,
      email: CONTRACT_TEST_ACTOR.email,
      role: "member",
    });
    cachedCookie = `fd_session=${token}`;
  }
  return cachedCookie;
}

interface CreatedCheck {
  id: string;
}

interface TriggerResult {
  succeeded: boolean;
  status: string;
  incidentOpened: boolean;
  incidentResolved: boolean;
}

async function createCheck(
  request: import("@playwright/test").APIRequestContext,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await request.post("/api/internal/v1/checks", {
    headers: { Cookie: await sessionCookieHeader() },
    data: {
      name: `contract-check-${crypto.randomUUID()}`,
      type: "http",
      target: "https://example.com",
      intervalSeconds: 60,
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json() as CreatedCheck;
  return body.id;
}

async function triggerCheck(
  request: import("@playwright/test").APIRequestContext,
  checkId: string,
): Promise<TriggerResult> {
  const res = await request.post(`/api/internal/v1/checks/${checkId}/trigger`, {
    headers: { Cookie: await sessionCookieHeader() },
  });
  expect(res.status()).toBe(200);
  return await res.json() as TriggerResult;
}

test("a manually-triggered HTTP check against a reachable target reports up", async ({ request }) => {
  const checkId = await createCheck(request, { target: "https://example.com" });
  const result = await triggerCheck(request, checkId);
  expect(result.succeeded).toBe(true);
  expect(result.status).toBe("up");

  const detail = await request.get(`/api/internal/v1/checks/${checkId}`, {
    headers: { Cookie: await sessionCookieHeader() },
  });
  const body = await detail.json() as { recentRuns: { succeeded: boolean }[] };
  expect(body.recentRuns.length).toBeGreaterThan(0);
});

test("a manually-triggered HTTP check against an unreachable target reports down", async ({ request }) => {
  const checkId = await createCheck(request, { target: "http://127.0.0.1:1" });
  const result = await triggerCheck(request, checkId);
  expect(result.succeeded).toBe(false);
  expect(result.status).toBe("down");
});

test("reaching the failure threshold opens exactly one incident; recovery resolves it", async ({ request }) => {
  const checkId = await createCheck(request, {
    target: "http://127.0.0.1:1",
    failureThreshold: 2,
    recoveryThreshold: 2,
  });

  const first = await triggerCheck(request, checkId);
  expect(first.incidentOpened).toBe(false);
  const second = await triggerCheck(request, checkId);
  expect(second.incidentOpened).toBe(true);
  const third = await triggerCheck(request, checkId);
  expect(third.incidentOpened).toBe(false); // still failing — no duplicate incident

  const incidentsRes = await request.get("/api/internal/v1/incidents", {
    headers: { Cookie: await sessionCookieHeader() },
  });
  const { incidents } = await incidentsRes.json() as {
    incidents: { checkId: string; resolvedAt: string | null }[];
  };
  const openForThisCheck = incidents.filter((i) => i.checkId === checkId && !i.resolvedAt);
  expect(openForThisCheck.length).toBe(1);

  // Point the same check at a reachable target and recover it (contracts/uptime-internal-api.md's
  // PATCH endpoint) — quickstart.md's "Validate User Story 2" flow.
  const patchRes = await request.patch(`/api/internal/v1/checks/${checkId}`, {
    headers: { Cookie: await sessionCookieHeader() },
    data: { target: "https://example.com" },
  });
  expect(patchRes.status()).toBe(200);

  await triggerCheck(request, checkId); // 1st recovery success
  const resolved = await triggerCheck(request, checkId); // 2nd — crosses recoveryThreshold
  expect(resolved.incidentResolved).toBe(true);
});

test("deleting a check with an open incident auto-resolves it, not left dangling", async ({ request }) => {
  const checkId = await createCheck(request, {
    target: "http://127.0.0.1:1",
    failureThreshold: 1,
  });
  const result = await triggerCheck(request, checkId);
  expect(result.incidentOpened).toBe(true);

  const del = await request.delete(`/api/internal/v1/checks/${checkId}`, {
    headers: { Cookie: await sessionCookieHeader() },
  });
  expect(del.status()).toBe(200);

  const incidentsRes = await request.get("/api/internal/v1/incidents", {
    headers: { Cookie: await sessionCookieHeader() },
  });
  const { incidents } = await incidentsRes.json() as {
    incidents: { checkId: string; resolvedAt: string | null }[];
  };
  const stillOpenForDeletedCheck = incidents.filter((i) => i.checkId === checkId && !i.resolvedAt);
  expect(stillOpenForDeletedCheck.length).toBe(0);
});

test("creating a check below the 60s minimum interval is rejected", async ({ request }) => {
  const res = await request.post("/api/internal/v1/checks", {
    headers: { Cookie: await sessionCookieHeader() },
    data: {
      name: "too-fast",
      type: "http",
      target: "https://example.com",
      intervalSeconds: 30,
    },
  });
  expect(res.status()).toBe(400);
});

// User Story 4 — webhook delivery, a request-capturing local endpoint the contract test controls
// (tasks.md T031). wrangler dev's real fetch() can reach a plain localhost listener.
test("an incident open fires exactly one webhook request, resolve fires exactly one more", async ({ request }) => {
  const received: Record<string, unknown>[] = [];
  const server = Deno.serve({ port: 0 }, async (req) => {
    received.push(await req.json());
    return new Response("ok");
  });
  const hookUrl = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/hook`;

  try {
    const checkId = await createCheck(request, {
      target: "http://127.0.0.1:1",
      failureThreshold: 1,
      recoveryThreshold: 1,
      webhookUrl: hookUrl,
    });

    await triggerCheck(request, checkId); // opens the incident -> 1 webhook call

    await request.patch(`/api/internal/v1/checks/${checkId}`, {
      headers: { Cookie: await sessionCookieHeader() },
      data: { target: "https://example.com" },
    });
    await triggerCheck(request, checkId); // resolves the incident -> 1 more webhook call

    // Bounded wait for both fire-and-forget deliveries to land (research.md §7 — no retry, but the
    // fetch itself is still in-flight when runCheck() returns).
    for (let i = 0; i < 20 && received.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(received.length).toBe(2);
    expect(received[0].event).toBe("incident.opened");
    expect(received[1].event).toBe("incident.resolved");
  } finally {
    await server.shutdown();
  }
});
