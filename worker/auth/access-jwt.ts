import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessIdentity {
  sub: string;
  email: string;
}

interface AccessEnv {
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
}

// One JWKS per team domain, reused across requests within a warm isolate so jose's own key-set
// caching (and not just ours) actually applies — a fresh createRemoteJWKSet() per request would
// hit /cdn-cgi/access/certs every time.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

// Verifies the Cf-Access-Jwt-Assertion header Cloudflare Access injects at /login — the only
// path this environment's Access application actually protects (research.md §1; constitution
// Principle II step 1). Returns null on ANY failure (missing header, bad signature, expired,
// issuer/audience mismatch, or a payload missing sub/email) — fail closed, no detail about which
// case it was.
export async function verifyAccessJwt(
  request: Request,
  env: AccessEnv,
): Promise<AccessIdentity | null> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    return null;
  }

  try {
    const jwks = getJWKS(env.TEAM_DOMAIN);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    });

    const sub = payload.sub;
    const email = payload.email;
    if (typeof sub !== "string" || typeof email !== "string") {
      return null;
    }

    return { sub, email };
  } catch {
    return null;
  }
}
