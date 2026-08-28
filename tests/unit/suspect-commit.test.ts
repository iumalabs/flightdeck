import { assertEquals } from "@std/assert";
import { lookupSuspectCommit } from "../../worker/modules/github/suspect-commit.ts";

// issue #126 — lookupSuspectCommit's own docstring promises it "Returns null (not an error)
// whenever a suspect commit simply can't be determined: no repo connected, the token exchange
// fails, the file has no commit history, or GitHub's API errors." A GitHub response that's HTTP
// 2xx but has a non-JSON body (a known GitHub failure mode on abuse-detection soft-blocks/infra
// hiccups) must degrade to null too, not throw.

// Same throwaway 2048-bit RSA keypair as tests/unit/github-verify-connection.test.ts and
// tests/unit/github-connect-route.test.ts — signAppJwt just needs to produce *a* signed JWT;
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

const GITHUB_ENV = { GITHUB_APP_ID: "app-123", GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY };

class FakeD1 {
  constructor(
    private connection: { owner: string; repo: string; installation_id: string } | null,
  ) {}

  prepare = (sql: string) => {
    return {
      bind: (..._args: unknown[]) => ({
        first: <T>() => {
          if (sql.startsWith("SELECT owner, repo, installation_id FROM repository_connections")) {
            return Promise.resolve(this.connection as unknown as T | undefined);
          }
          return Promise.resolve(undefined as unknown as T | undefined);
        },
      }),
    };
  };
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

Deno.test("lookupSuspectCommit returns null (not a throw) when GitHub's commits response is 2xx with a non-JSON body", async () => {
  const db = new FakeD1({ owner: "iumalabs", repo: "flightdeck", installation_id: "42" });
  const mock = mockFetchSequence([
    // token exchange
    new Response(JSON.stringify({ token: "ghs_real", expires_at: "2099-01-01T00:00:00Z" }), {
      status: 201,
    }),
    // commits lookup: 2xx but a body that isn't valid JSON — GitHub's abuse-detection/infra
    // soft-block failure mode.
    new Response("<html>abuse detection triggered</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
  ]);
  try {
    const result = await lookupSuspectCommit(
      db as unknown as D1Database,
      GITHUB_ENV,
      "1",
      "CartSummary.tsx",
    );
    assertEquals(result, null);
  } finally {
    mock.restore();
  }
});

Deno.test("lookupSuspectCommit returns the top commit on a genuinely valid 2xx JSON response (working case still works)", async () => {
  const db = new FakeD1({ owner: "iumalabs", repo: "flightdeck", installation_id: "42" });
  const mock = mockFetchSequence([
    new Response(JSON.stringify({ token: "ghs_real", expires_at: "2099-01-01T00:00:00Z" }), {
      status: 201,
    }),
    new Response(
      JSON.stringify([
        {
          sha: "abc123",
          html_url: "https://github.com/iumalabs/flightdeck/commit/abc123",
          commit: { message: "fix cart summary", author: { name: "Ada" } },
          author: { login: "ada" },
        },
      ]),
      { status: 200 },
    ),
  ]);
  try {
    const result = await lookupSuspectCommit(
      db as unknown as D1Database,
      GITHUB_ENV,
      "1",
      "CartSummary.tsx",
    );
    assertEquals(result, {
      sha: "abc123",
      message: "fix cart summary",
      author: "Ada",
      url: "https://github.com/iumalabs/flightdeck/commit/abc123",
    });
  } finally {
    mock.restore();
  }
});

Deno.test("lookupSuspectCommit returns null when no repository is connected, without calling GitHub", async () => {
  const db = new FakeD1(null);
  const mock = mockFetchSequence([new Response("", { status: 200 })]);
  try {
    const result = await lookupSuspectCommit(
      db as unknown as D1Database,
      GITHUB_ENV,
      "1",
      "CartSummary.tsx",
    );
    assertEquals(result, null);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test("lookupSuspectCommit returns null when the commits endpoint itself errors (non-2xx)", async () => {
  const db = new FakeD1({ owner: "iumalabs", repo: "flightdeck", installation_id: "42" });
  const mock = mockFetchSequence([
    new Response(JSON.stringify({ token: "ghs_real", expires_at: "2099-01-01T00:00:00Z" }), {
      status: 201,
    }),
    new Response("", { status: 500 }),
  ]);
  try {
    const result = await lookupSuspectCommit(
      db as unknown as D1Database,
      GITHUB_ENV,
      "1",
      "CartSummary.tsx",
    );
    assertEquals(result, null);
  } finally {
    mock.restore();
  }
});

Deno.test("lookupSuspectCommit returns null when filePath is absent", async () => {
  const db = new FakeD1({ owner: "iumalabs", repo: "flightdeck", installation_id: "42" });
  const mock = mockFetchSequence([new Response("", { status: 200 })]);
  try {
    const result = await lookupSuspectCommit(db as unknown as D1Database, GITHUB_ENV, "1", null);
    assertEquals(result, null);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});
