import { Hono } from "hono";
import { loginRoute } from "./auth/login-route.ts";
import { identityRoutes } from "./modules/identity/routes.ts";
import type { SessionIdentity } from "./auth/session.ts";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  CF_ACCOUNT_ID: string;
  SESSION_SECRET: string;
}

const app = new Hono<{ Bindings: Env; Variables: { identity: SessionIdentity } }>();

// /login is the only route Cloudflare Access actually protects (research.md §1) — it verifies
// the Access JWT and mints FlightDeck's own session cookie (constitution Principle II).
app.route("/", loginRoute);

// Every other control-plane route is gated by sessionAuth (mounted inside identityRoutes) instead
// of Access directly, since Access doesn't inject its header outside /login.
app.route("/api/internal", identityRoutes);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname === "/login" || url.pathname === "/logout" || url.pathname.startsWith("/api/")
    ) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { app };
