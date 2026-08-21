import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { verifyAccessJwt } from "./access-jwt.ts";
import { mintSession, SESSION_COOKIE, setSessionCookie } from "./session.ts";
import { upsertUser } from "../modules/identity/users.ts";

interface Env {
  DB: D1Database;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  SESSION_SECRET: string;
}

export const loginRoute = new Hono<{ Bindings: Env }>();

// The only route Cloudflare Access actually protects in this environment (research.md §1).
// Verifies the Access JWT (constitution Principle II step 1), upserts the user, and mints
// FlightDeck's own session token (step 2) before redirecting into the app shell. Any
// verification failure is a fail-closed 403 with no session minted.
loginRoute.get("/login", async (c) => {
  const identity = await verifyAccessJwt(c.req.raw, c.env);
  if (!identity) {
    return c.text("Forbidden", 403);
  }

  // "idp" enrichment (research.md §2 references FlareTower's get-identity pattern) is not called
  // in this module — a fixed label is enough for the users table's NOT NULL idp column until a
  // later module needs the richer value.
  const operator = await upsertUser(c.env.DB, {
    sub: identity.sub,
    email: identity.email,
    idp: "cloudflare-access",
  });

  const token = await mintSession(operator, c.env);
  setSessionCookie(c, token);

  return c.redirect("/web-app/", 302);
});

// fd_session is HttpOnly (constitution Principle IX), so client JS cannot clear it directly —
// sign-out MUST go through a server route that overwrites it with an expired cookie. This is
// still purely local to FlightDeck's own session (research.md §3): it does not touch the
// underlying Cloudflare Access session, which Access continues to own.
loginRoute.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});
