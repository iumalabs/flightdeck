import { assertEquals } from "@std/assert";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyAccessJwt } from "../../worker/auth/access-jwt.ts";

const POLICY_AUD = "test-aud-tag";

// verifyAccessJwt caches its JWKS fetcher per team domain (by design — see research.md §1's
// production-performance rationale). Each test therefore uses its OWN unique team domain, so
// tests never share (or race on) that module-level cache.
function uniqueTeamDomain(): string {
  return `https://test-team-${crypto.randomUUID()}.cloudflareaccess.com`;
}

async function setUpTestJwks(teamDomain: string) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = "test-key-1";
  const jwks = { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === `${teamDomain}/cdn-cgi/access/certs`) {
      return Promise.resolve(new Response(JSON.stringify(jwks), { status: 200 }));
    }
    return originalFetch(input as RequestInfo);
  }) as typeof fetch;

  return {
    privateKey,
    kid,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

async function signToken(
  privateKey: PrivateKey,
  kid: string,
  teamDomain: string,
  claims: Record<string, unknown>,
  opts: { issuer?: string; audience?: string; expired?: boolean } = {},
) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? teamDomain)
    .setAudience(opts.audience ?? POLICY_AUD)
    .setExpirationTime(opts.expired ? "-1h" : "1h");
  return await jwt.sign(privateKey);
}

Deno.test("verifyAccessJwt returns the identity for a valid token", async () => {
  const teamDomain = uniqueTeamDomain();
  const { privateKey, kid, restore } = await setUpTestJwks(teamDomain);
  try {
    const token = await signToken(privateKey, kid, teamDomain, {
      sub: "user-1",
      email: "a@example.com",
    });
    const request = new Request("https://flightdeck.iuma.dev/login", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const identity = await verifyAccessJwt(request, { TEAM_DOMAIN: teamDomain, POLICY_AUD });
    assertEquals(identity, { sub: "user-1", email: "a@example.com" });
  } finally {
    restore();
  }
});

Deno.test("verifyAccessJwt returns null when the header is missing", async () => {
  const teamDomain = uniqueTeamDomain();
  const request = new Request("https://flightdeck.iuma.dev/login");
  const identity = await verifyAccessJwt(request, { TEAM_DOMAIN: teamDomain, POLICY_AUD });
  assertEquals(identity, null);
});

Deno.test("verifyAccessJwt returns null for a signature from the wrong key", async () => {
  const teamDomain = uniqueTeamDomain();
  const { kid, restore } = await setUpTestJwks(teamDomain);
  try {
    const { privateKey: wrongKey } = await generateKeyPair("RS256");
    const token = await signToken(wrongKey, kid, teamDomain, {
      sub: "user-1",
      email: "a@example.com",
    });
    const request = new Request("https://flightdeck.iuma.dev/login", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const identity = await verifyAccessJwt(request, { TEAM_DOMAIN: teamDomain, POLICY_AUD });
    assertEquals(identity, null);
  } finally {
    restore();
  }
});

Deno.test("verifyAccessJwt returns null for a wrong audience", async () => {
  const teamDomain = uniqueTeamDomain();
  const { privateKey, kid, restore } = await setUpTestJwks(teamDomain);
  try {
    const token = await signToken(
      privateKey,
      kid,
      teamDomain,
      { sub: "user-1", email: "a@example.com" },
      { audience: "some-other-app" },
    );
    const request = new Request("https://flightdeck.iuma.dev/login", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const identity = await verifyAccessJwt(request, { TEAM_DOMAIN: teamDomain, POLICY_AUD });
    assertEquals(identity, null);
  } finally {
    restore();
  }
});

Deno.test("verifyAccessJwt returns null for a wrong issuer", async () => {
  const teamDomain = uniqueTeamDomain();
  const { privateKey, kid, restore } = await setUpTestJwks(teamDomain);
  try {
    const token = await signToken(
      privateKey,
      kid,
      teamDomain,
      { sub: "user-1", email: "a@example.com" },
      { issuer: "https://someone-else.cloudflareaccess.com" },
    );
    const request = new Request("https://flightdeck.iuma.dev/login", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const identity = await verifyAccessJwt(request, { TEAM_DOMAIN: teamDomain, POLICY_AUD });
    assertEquals(identity, null);
  } finally {
    restore();
  }
});

Deno.test("verifyAccessJwt returns null for an expired token", async () => {
  const teamDomain = uniqueTeamDomain();
  const { privateKey, kid, restore } = await setUpTestJwks(teamDomain);
  try {
    const token = await signToken(
      privateKey,
      kid,
      teamDomain,
      { sub: "user-1", email: "a@example.com" },
      { expired: true },
    );
    const request = new Request("https://flightdeck.iuma.dev/login", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const identity = await verifyAccessJwt(request, { TEAM_DOMAIN: teamDomain, POLICY_AUD });
    assertEquals(identity, null);
  } finally {
    restore();
  }
});
