import { Hono } from "hono";
import { loginRoute } from "./auth/login-route.ts";
import { identityRoutes } from "./modules/identity/routes.ts";
import { ingestRoutes } from "./modules/ingest/routes.ts";
import { issuesRoutes } from "./modules/issues/routes.ts";
import { projectsRoutes } from "./modules/projects/routes.ts";
import { githubRoutes } from "./modules/github/routes.ts";
import { tracesRoutes } from "./modules/traces/routes.ts";
import { logExportRoutes, logsRoutes } from "./modules/logs/routes.ts";
import {
  pruneOldEvents,
  pruneOldLogBatches,
  pruneOldTransactions,
} from "./modules/ingest/retention.ts";
import { handleTraceIngestBatch } from "./modules/ingest/trace-consumer.ts";
import type { QueuedTransaction } from "./modules/ingest/trace-consumer.ts";
import { handleLogIngestBatch } from "./modules/ingest/log-consumer.ts";
import type { QueuedLogBatch } from "./modules/ingest/log-consumer.ts";
import type { SessionIdentity } from "./auth/session.ts";
import { RateLimiter } from "./durable-objects/rate-limiter.ts";
import { LiveTail } from "./durable-objects/live-tail.ts";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SOURCE_MAPS: R2Bucket;
  LOGS: R2Bucket;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  LIVE_TAIL: DurableObjectNamespace<LiveTail>;
  TRACE_INGEST: Queue<QueuedTransaction>;
  LOG_INGEST: Queue<QueuedLogBatch>;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  CF_ACCOUNT_ID: string;
  SESSION_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  CLOUDFLARE_R2_ADMIN_TOKEN: string;
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
app.route("/api/internal/projects", logExportRoutes);
app.route("/api/internal/traces", tracesRoutes);
app.route("/api/internal/logs", logsRoutes);

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
    // shorter 30-day window. specs/004-structured-logs research.md §9 extends it further to
    // log_batches, on the shortest window of any module (7 days) — full deletion including the
    // underlying R2 NDJSON object, since a log_batches row is itself the summary.
    ctx.waitUntil(
      Promise.all([
        pruneOldEvents(env.DB),
        pruneOldTransactions(env.DB),
        pruneOldLogBatches(env.DB, env.LOGS),
      ]).then(() => undefined),
    );
  },

  // Two independent queues share this one queue() export, dispatched by `batch.queue` name
  // (specs/004-structured-logs research.md §4) — a backlog in one must never delay the other, so
  // each keeps its own consumer function and, upstream, its own producer binding/rate-limit key.
  queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (batch.queue.endsWith("-log-ingest")) {
      return handleLogIngestBatch(batch as MessageBatch<QueuedLogBatch>, env);
    }
    return handleTraceIngestBatch(batch as MessageBatch<QueuedTransaction>, env);
  },
} satisfies ExportedHandler<Env>;

export { app };
export { LiveTail, RateLimiter };
