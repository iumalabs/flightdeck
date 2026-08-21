import { Hono } from "hono";
import { loginRoute } from "./auth/login-route.ts";
import { identityRoutes } from "./modules/identity/routes.ts";
import { ingestRoutes } from "./modules/ingest/routes.ts";
import type { SessionIdentity } from "./auth/session.ts";
import { RateLimiter } from "./durable-objects/rate-limiter.ts";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SOURCE_MAPS: R2Bucket;
  RATE_LIMITER: DurableObjectNamespace;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  CF_ACCOUNT_ID: string;
  SESSION_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}

const app = new Hono<{ Bindings: Env; Variables: { identity: SessionIdentity } }>();

// /login is the only route Cloudflare Access actually protects (research.md §1) — it verifies
// the Access JWT and mints FlightDeck's own session cookie (constitution Principle II).
app.route("/", loginRoute);

// Every other control-plane route is gated by sessionAuth (mounted inside identityRoutes) instead
// of Access directly, since Access doesn't inject its header outside /login.
app.route("/api/internal", identityRoutes);

// Public, DSN-key-authenticated ingest (constitution Principle III) — deliberately NOT behind
// sessionAuth or Access. Registered as a sibling to /api/internal, not nested inside it; Hono
// resolves the literal "internal" path segment ahead of the dynamic :projectId segment at the same
// position, and the ingest handler itself defensively rejects project_id "internal" regardless
// (research.md §3, specs/002-error-monitoring). Mounted at "/api" (not "/api/:projectId") so the
// full ":projectId/envelope" pattern is defined directly inside ingestRoutes, rather than relying
// on Hono's cross-router param propagation.
app.route("/api", ingestRoutes);

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

  scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): void {
    // Daily retention prune (constitution Principle IX) lands in the Polish phase (T043,
    // specs/002-error-monitoring/tasks.md) — this Foundational-phase stub exists so the
    // wrangler.jsonc cron trigger and the handler shape are in place before that task needs them.
  },
} satisfies ExportedHandler<Env>;

export { app };
export { RateLimiter };
