import { jwtVerify, SignJWT } from "jose";
import { getCookie, setCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";

export interface SessionIdentity {
  sub: string;
  email: string;
  role: string;
}

interface SessionEnv {
  SESSION_SECRET: string;
}

export const SESSION_COOKIE = "fd_session";

// FlightDeck's own signed session token (constitution Principle II step 2) — minted once at
// /login after the Access JWT verifies (step 1), then used to authenticate every other
// control-plane request, since Access does not inject Cf-Access-Jwt-Assertion outside the one
// path it actually protects (research.md §1).
export async function mintSession(identity: SessionIdentity, env: SessionEnv): Promise<string> {
  const key = new TextEncoder().encode(env.SESSION_SECRET);
  return await new SignJWT({ email: identity.email, role: identity.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.sub)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key);
}

export async function verifySessionToken(
  token: string,
  env: SessionEnv,
): Promise<SessionIdentity | null> {
  try {
    const key = new TextEncoder().encode(env.SESSION_SECRET);
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const sub = payload.sub;
    const email = payload.email;
    const role = payload.role;
    if (typeof sub !== "string" || typeof email !== "string" || typeof role !== "string") {
      return null;
    }
    return { sub, email, role };
  } catch {
    return null;
  }
}

export function setSessionCookie(
  c: Parameters<typeof setCookie>[0],
  token: string,
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

// Gates every other control-plane request (constitution Principle II step 2). Fail-closed 403 on
// a missing, invalid, expired, or tampered fd_session cookie — same rule as step 1's Access JWT
// check, no degraded mode.
export const sessionAuth: MiddlewareHandler<
  { Bindings: SessionEnv; Variables: { identity: SessionIdentity } }
> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.text("Forbidden", 403);
  }

  const identity = await verifySessionToken(token, c.env);
  if (!identity) {
    return c.text("Forbidden", 403);
  }

  c.set("identity", identity);
  await next();
};
