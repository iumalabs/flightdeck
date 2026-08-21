import { assertEquals, assertExists } from "@std/assert";
import { importSPKI, jwtVerify } from "jose";
import {
  exchangeInstallationToken,
  getInstallationToken,
  signAppJwt,
} from "../../worker/modules/github/app-auth.ts";

// A throwaway 2048-bit RSA keypair generated solely for this test (`openssl genpkey`) — never
// used anywhere real. Only signAppJwt needs the private half; jwtVerify below uses the public
// half to prove the signature is genuine, not just present.
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

const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs1mQPDX7aubjs/eukjKE
HZVoMEzg1TBfUtFZGKrn5+QCLMAsx8dFFgyrLctR+xLvknHHFQTYlIf5nmojCwEi
t5SefjdjJ+qGJXpY9g3g4Zz99kEq0bYzR7/cIUDGXPAHGSF9UceEoWow9JUb9Ctg
bDUbjLF5U4WhtfOIgXDG06txIr3l8oq4L6Cas0CxqbWWQH2r2rwLt2Xz2szHNPQF
f43aY+o7N7Q6//L2DedvdeTVjbnGflh3vS3WAffIsKLsaOGQttTw3Pq1O44BddXC
rJzhJg7mLVpwGCRux0/hMxhQL8RtEfbVzn3Qvl3FX/GRiFBqcRBTGcrlAYmE+k/q
eQIDAQAB
-----END PUBLIC KEY-----`;

Deno.test("signAppJwt produces a JWT that verifies against the App's public key", async () => {
  const jwt = await signAppJwt("app-123", TEST_PRIVATE_KEY);
  const publicKey = await importSPKI(TEST_PUBLIC_KEY, "RS256");
  const { payload, protectedHeader } = await jwtVerify(jwt, publicKey, { algorithms: ["RS256"] });

  assertEquals(protectedHeader.alg, "RS256");
  assertEquals(payload.iss, "app-123");
  assertExists(payload.iat);
  assertExists(payload.exp);
});

Deno.test("exchangeInstallationToken calls the documented endpoint and returns the token", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: string | undefined;
  let capturedAuth: string | null | undefined;
  try {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth = new Headers(init?.headers).get("Authorization");
      return Promise.resolve(
        new Response(JSON.stringify({ token: "ghs_fake", expires_at: "2099-01-01T00:00:00Z" }), {
          status: 201,
        }),
      );
    }) as typeof fetch;

    const token = await exchangeInstallationToken("fake-app-jwt", "99");

    assertEquals(token, "ghs_fake");
    assertEquals(capturedUrl, "https://api.github.com/app/installations/99/access_tokens");
    assertEquals(capturedAuth, "Bearer fake-app-jwt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("exchangeInstallationToken returns null when GitHub responds with an error", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (() => Promise.resolve(new Response("", { status: 401 }))) as typeof fetch;
    const token = await exchangeInstallationToken("fake-app-jwt", "99");
    assertEquals(token, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("getInstallationToken signs a JWT and exchanges it without hitting the real network", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/installations/42/access_tokens")) {
        return Promise.resolve(new Response("", { status: 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ token: "ghs_real", expires_at: "2099-01-01T00:00:00Z" }), {
          status: 201,
        }),
      );
    }) as typeof fetch;

    const token = await getInstallationToken("app-123", TEST_PRIVATE_KEY, "42");
    assertEquals(token, "ghs_real");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("getInstallationToken returns null (not a throw) when signing fails", async () => {
  const token = await getInstallationToken("app-123", "not-a-real-pem", "42");
  assertEquals(token, null);
});
