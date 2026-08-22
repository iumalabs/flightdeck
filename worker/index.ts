import { Hono } from "hono";
import { loginRoute } from "./auth/login-route.ts";
import { identityRoutes } from "./modules/identity/routes.ts";
import { ingestRoutes } from "./modules/ingest/routes.ts";
import { issuesRoutes } from "./modules/issues/routes.ts";
import { projectsRoutes } from "./modules/projects/routes.ts";
import { githubRoutes } from "./modules/github/routes.ts";
import { tracesRoutes } from "./modules/traces/routes.ts";
import { pruneOldEvents, pruneOldTransactions } from "./modules/ingest/retention.ts";
import { handleTraceIngestBatch } from "./modules/ingest/trace-consumer.ts";
import type { QueuedTransaction } from "./modules/ingest/trace-consumer.ts";
import type { SessionIdentity } from "./auth/session.ts";
import { RateLimiter } from "./durable-objects/rate-limiter.ts";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SOURCE_MAPS: R2Bucket;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  TRACE_INGEST: Queue<QueuedTransaction>;
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
app.route("/api/internal/issues", issuesRoutes);
app.route("/api/internal/projects", projectsRoutes);
app.route("/api/internal/projects", githubRoutes);
app.route("/api/internal/traces", tracesRoutes);

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

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    // Daily retention prune (constitution Principle IX, spec FR-015) — deletes events past the
    // default 90-day window (research.md §8); the owning issue's summary row is untouched.
    // specs/003-distributed-tracing research.md §8 extends this to transactions, on their own
    // shorter 30-day window — a transactions row is itself the summary, so pruning is full deletion.
    ctx.waitUntil(
      Promise.all([pruneOldEvents(env.DB), pruneOldTransactions(env.DB)]).then(() => undefined),
    );
  },

  // Trace ingest's queue consumer (specs/003-distributed-tracing research.md §4) — each message
  // in the batch is written and ack'd/retried independently in handleTraceIngestBatch, never a
  // whole-batch success/failure.
  queue(batch: MessageBatch<QueuedTransaction>, env: Env): Promise<void> {
    return handleTraceIngestBatch(batch, env);
  },
} satisfies ExportedHandler<Env, QueuedTransaction>;

export { app };
export { RateLimiter };
