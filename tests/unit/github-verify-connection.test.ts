import { assertEquals } from "@std/assert";
import { verifyInstallationCoversRepo } from "../../worker/modules/github/verify-connection.ts";

// Same throwaway 2048-bit RSA keypair as tests/unit/github-app-auth.test.ts — only the private half
// is needed here since signAppJwt just needs to produce *a* signed JWT; GitHub's response is mocked.
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

function mockFetchSequence(responses: Response[]) {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let i = 0;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    const response = responses[i] ?? responses[responses.length - 1];
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

Deno.test("verifyInstallationCoversRepo rejects a fake/nonexistent installation ID (401/404) without ever calling the repo endpoint", async () => {
  const mock = mockFetchSequence([
    new Response("", { status: 404 }),
  ]);
  try {
    const result = await verifyInstallationCoversRepo(
      "app-123",
      TEST_PRIVATE_KEY,
      "999999999",
      "nonexistent-owner-qa",
      "nonexistent-repo-qa",
    );
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.status, 400);
    assertEquals(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("verifyInstallationCoversRepo rejects a real installation that doesn't cover the given owner/repo", async () => {
  const mock = mockFetchSequence([
    new Response(JSON.stringify({ token: "ghs_real", expires_at: "2099-01-01T00:00:00Z" }), {
      status: 201,
    }),
    new Response("", { status: 404 }), // installation token has no access to this owner/repo
  ]);
  try {
    const result = await verifyInstallationCoversRepo(
      "app-123",
      TEST_PRIVATE_KEY,
      "42",
      "some-owner",
      "some-other-repo",
    );
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.status, 400);
    assertEquals(mock.calls.length, 2);
  } finally {
    mock.restore();
  }
});

Deno.test("verifyInstallationCoversRepo succeeds for a genuinely valid installation+owner+repo", async () => {
  const mock = mockFetchSequence([
    new Response(JSON.stringify({ token: "ghs_real", expires_at: "2099-01-01T00:00:00Z" }), {
      status: 201,
    }),
    new Response(JSON.stringify({ full_name: "iumalabs/flightdeck" }), { status: 200 }),
  ]);
  try {
    const result = await verifyInstallationCoversRepo(
      "app-123",
      TEST_PRIVATE_KEY,
      "42",
      "iumalabs",
      "flightdeck",
    );
    assertEquals(result, { ok: true });
    assertEquals(mock.calls[0], "https://api.github.com/app/installations/42/access_tokens");
    assertEquals(mock.calls[1], "https://api.github.com/repos/iumalabs/flightdeck");
  } finally {
    mock.restore();
  }
});

Deno.test("verifyInstallationCoversRepo reports 502 (not 400) when GitHub itself errors, not the input", async () => {
  const mock = mockFetchSequence([
    new Response("", { status: 500 }),
  ]);
  try {
    const result = await verifyInstallationCoversRepo(
      "app-123",
      TEST_PRIVATE_KEY,
      "42",
      "iumalabs",
      "flightdeck",
    );
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.status, 502);
  } finally {
    mock.restore();
  }
});

Deno.test("verifyInstallationCoversRepo reports 502 when GitHub is unreachable (network error)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    const result = await verifyInstallationCoversRepo(
      "app-123",
      TEST_PRIVATE_KEY,
      "42",
      "iumalabs",
      "flightdeck",
    );
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("verifyInstallationCoversRepo reports 502 when signing the App JWT fails", async () => {
  const result = await verifyInstallationCoversRepo(
    "app-123",
    "not-a-real-pem",
    "42",
    "iumalabs",
    "flightdeck",
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 502);
});
