import { assertEquals } from "@std/assert";
import { githubRoutes } from "../../worker/modules/github/routes.ts";
import { mintSession } from "../../worker/auth/session.ts";

// issue #98 — proves POST /:id/github/connect actually calls GitHub before persisting anything: a
// fabricated installation ID (or one that doesn't cover the given owner/repo) is rejected and never
// written to repository_connections, while a genuinely valid installation+owner+repo still
// succeeds and persists exactly as before.

// Same throwaway 2048-bit RSA keypair as tests/unit/github-app-auth.test.ts and
// tests/unit/github-verify-connection.test.ts — signAppJwt just needs to produce a signed JWT;
// GitHub's response is mocked below, never hit over the real network.
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCzWZA8Nftq5uOz
966SMoQdlWgwTODVMF9S0VkYqufn5AIswCzHx0UWDKsty1H7Eu+ScccVBNiUh/me
aiMLASK3lJ5+N2Mn6oYlelj2DeDhnP32QSrRtjNHv9whQMZc8AcZIX1Rx4ShajD0
lRv0K2BsNRuMsXlThaG184iBcMbTq3EiveXyirgvoJqzQLGptZZAfavavAu3ZfPa
zMc09AV/jdpj6js3tDr/8vYN52915NWNucZ+WHe9LdYB98iwouxo4ZC21PDc+rU7
jgF11cKsnOEmDuYtWnAYJG7HT+EzGFAvxG0R9tXOfdC+XcVf8ZGIUGpxEFMZyuUB
iYT6T+p5AgMBAAECggEARpN4kFEX2kX4leHiJvLNDY01PkiKcypBYKg0HOJoNtcB
ShXnqUgPtjEPDYrEfH5Dm0e9tVY+Whi2EHIozxRH0qEfy4BFOzhtSINATbdBZtbu
E0EqtfKydEoaOFWymXD1Ah0tIQjX9uMAV8bzhJ6rJ3mwmSlfmo/sBltKvNEh1Lop
oN5vjjlmUhh8yyspahg6dC6dtXZnSQw87Ur44ViCGDG1Fwe5Ya09pqgbzkhaZv1e
DQ4JnjpaYF4Rgf4rmcPgTa2r+D+tbUjXTifNwpMVyvH7VlDOB66ELb8UaFqfRx5J
wYXjN+j10yi//NHeEVcvXiJGIG3Kssy49Xpd6OxEBwKBgQDpMhH/B3kTle0f4+Jt
mMGP1VVoDtl0BUT93ieGgO50dbU3lkW5EaYk7gV4k62ZADMGL/KfxP2ciFoKd7yM
GSBdSjxLa8vy33mqczYrDYbGvF6Osc/P7KdC30TYL3gERVgs6K49bUG+APZVykad
KXNfyCJugbnFre+DvevLWLRLywKBgQDE435PbZLFi+uGpVb75JXRI40399vGih/o
r1+fF2HiQBJiuGRLa3XFOr4zWOapXXifeLzL0wKiHyiE6D5jLowVN26u6sLk76OX
KdmpkMueLVz/SCLzpOC9orKM03tAkZjXB2vneDwcdlBmysIDcquDBVssCW0BRJLT
DgeOzi5iSwKBgEJ16LccdB9m3Vv3YLMHlDLgBCVSBhuQ3ObVh8JHwK4kVe9vvpNO
OmHQDHMe85zld6VNyQJL7FPOcIsHMQ9kodq0q5Z7NHcVxeEUUN3YTw8Y5IIanzWN
JuZiJ4bNkJD3CnhSIEaVeuUh9RLiQVnNVHp52YZRJpb2SYrsd+VOdKQdAoGBAJKe
Zt13V6lMvSQT1GbYnsiTlQJszXlYOtLoZmju3LHDzO0/K1EOwTESwbkzJvJQ7Ra0
rsOKa5eXZHE1EeCCNUdHdGFF6cTawBQ90h13+mncljh027Jcwg/2LMi6ZDp9MjhP
Cofg/cKkSNODgl9W8WosfuyYSFh9XGlXNUGfQONpAoGATElVkJvYvC8dTd5meUc/
RxEo1qkIbd6cyObjBKdJNYOPaRx/LBE5wI88t2kNLW3pMEFb12/HptHd0Fiv9scZ
kzEX8skHsqQhI7d20xPnnTV+PbyvDNLUR0YsccxsAnh/chSqgVe41j9mVLHfg3nD
zSPaLG9OBoEOCDZdzJdq+aE=
-----END PRIVATE KEY-----`;

const SESSION_SECRET = "test-session-secret-for-github-connect-route";
const GITHUB_APP_ID = "app-123";

const TEST_ENV = {
  GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY,
  SESSION_SECRET,
};

class FakeD1 {
  connections: unknown[][] = [];
  auditLog: unknown[][] = [];

  prepare = (sql: string) => {
    return {
      bind: (...args: unknown[]) => ({
        run: () => {
          if (sql.startsWith("INSERT INTO repository_connections")) {
            this.connections.push(args);
          }
          if (sql.startsWith("INSERT INTO audit_log")) {
            this.auditLog.push(args);
          }
          return Promise.resolve({ meta: { changes: 1 } });
        },
      }),
    };
  };
}

async function sessionCookieHeader(): Promise<string> {
  const token = await mintSession(
    { sub: "user-1", email: "user@example.com", role: "member" },
    { SESSION_SECRET },
  );
  return `fd_session=${token}`;
}

function mockFetchSequence(responses: Response[]) {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let i = 0;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    const response = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve(response);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function postConnect(
  db: FakeD1,
  body: Record<string, unknown>,
): Promise<Response> {
  return await githubRoutes.request(
    "/1/github/connect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: await sessionCookieHeader() },
      body: JSON.stringify(body),
    },
    { ...TEST_ENV, DB: db },
  );
}

Deno.test("POST /:id/github/connect rejects a fake/nonexistent installation ID and never persists it", async () => {
  const mock = mockFetchSequence([new Response("", { status: 404 })]);
  try {
    const db = new FakeD1();
    const res = await postConnect(db, {
      installationId: "999999999",
      owner: "nonexistent-owner-qa",
      repo: "nonexistent-repo-qa",
    });
    assertEquals(res.status, 400);
    assertEquals(db.connections.length, 0);
    assertEquals(db.auditLog.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test("POST /:id/github/connect rejects a real installation that doesn't cover the given owner/repo, and never persists it", async () => {
  const mock = mockFetchSequence([
    new Response(JSON.stringify({ token: "ghs_real", expires_at: "2099-01-01T00:00:00Z" }), {
      status: 201,
    }),
    new Response("", { status: 404 }), // installation token has no access to this owner/repo
  ]);
  try {
    const db = new FakeD1();
    const res = await postConnect(db, {
      installationId: "42",
      owner: "some-owner",
      repo: "repo-this-installation-cannot-see",
    });
    assertEquals(res.status, 400);
    assertEquals(db.connections.length, 0);
    assertEquals(db.auditLog.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test("POST /:id/github/connect persists a genuinely valid installation+owner+repo (working case still works)", async () => {
  const mock = mockFetchSequence([
    new Response(JSON.stringify({ token: "ghs_real", expires_at: "2099-01-01T00:00:00Z" }), {
      status: 201,
    }),
    new Response(JSON.stringify({ full_name: "iumalabs/flightdeck" }), { status: 200 }),
  ]);
  try {
    const db = new FakeD1();
    const res = await postConnect(db, {
      installationId: "42",
      owner: "iumalabs",
      repo: "flightdeck",
    });
    assertEquals(res.status, 200);
    const responseBody = await res.json();
    assertEquals(responseBody, { owner: "iumalabs", repo: "flightdeck" });
    assertEquals(db.connections.length, 1);
    assertEquals(db.connections[0], ["1", "iumalabs", "flightdeck", "42"]);
    assertEquals(db.auditLog.length, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("POST /:id/github/connect returns 502 (not 400) and does not persist when GitHub itself errors", async () => {
  const mock = mockFetchSequence([new Response("", { status: 503 })]);
  try {
    const db = new FakeD1();
    const res = await postConnect(db, {
      installationId: "42",
      owner: "iumalabs",
      repo: "flightdeck",
    });
    assertEquals(res.status, 502);
    assertEquals(db.connections.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test("POST /:id/github/connect still rejects malformed bodies before ever calling GitHub", async () => {
  const db = new FakeD1();
  const res = await githubRoutes.request(
    "/1/github/connect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: await sessionCookieHeader() },
      body: JSON.stringify({ installationId: 12345, owner: "iumalabs", repo: "flightdeck" }),
    },
    { ...TEST_ENV, DB: db },
  );
  assertEquals(res.status, 400);
  assertEquals(db.connections.length, 0);
});
