import { Hono } from "hono";
import { loginRoute } from "./auth/login-route.ts";
import { identityRoutes } from "./modules/identity/routes.ts";
import { ingestRoutes } from "./modules/ingest/routes.ts";
import { issuesRoutes } from "./modules/issues/routes.ts";
import { projectsRoutes } from "./modules/projects/routes.ts";
import { githubRoutes } from "./modules/github/routes.ts";
import { tracesRoutes } from "./modules/traces/routes.ts";
import { logExportRoutes, logsRoutes } from "./modules/logs/routes.ts";
import { uptimeRoutes } from "./modules/uptime/routes.ts";
import { runCheck } from "./modules/uptime/evaluate.ts";
import { feedbackRoutes } from "./modules/feedback/routes.ts";
import { handleDialogGet, handleDialogPost } from "./modules/feedback/dialog.ts";
import {
  apiTokensRoutes,
  releasesCliRoutes,
  releasesInternalRoutes,
} from "./modules/releases/routes.ts";
import {
  pruneOldCheckRuns,
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
import { APP_VERSION } from "./version.ts";

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
  DEPLOY_ENV: string;
  SESSION_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  CLOUDFLARE_R2_ADMIN_TOKEN: string;
}

const app = new Hono<{ Bindings: Env; Variables: { identity: SessionIdentity } }>();

// issues/23 — without this, an unhandled exception anywhere in a route handler fell through to
// Hono's default error response with zero diagnostic detail (the exact "generic 500, no way to
// tell failure causes apart" symptom that issue described) and, worse, nothing logged it anywhere
// — a real gap on a platform whose entire purpose is surfacing errors. `console.error` here is
// what a `wrangler tail`/Workers Logs session actually needs to see to pin down which write path
// is throwing and why; the response body stays a generic message (never the raw exception) so an
// internal detail is never leaked to the client.
app.onError((err, c) => {
  console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, err);
  return c.text("Internal Server Error", 500);
});

// issues/32 — public and unauthenticated on purpose: the whole point is confirming from the
// OUTSIDE, with nothing more than curl, which environment's bindings a live deployment is
// actually running with — no Cloudflare dashboard/API access needed. Added after a real incident
// where the production custom domain was silently serving preview's bindings (wrong D1 database)
// with no visible symptom short of ingest itself failing.
app.get("/api/version", (c) => c.json({ version: APP_VERSION, environment: c.env.DEPLOY_ENV }));

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
app.route("/api/internal/releases", releasesInternalRoutes);
app.route("/api/internal/projects", apiTokensRoutes);
app.route("/api/internal", uptimeRoutes);
app.route("/api/internal/feedback", feedbackRoutes);

// Public, DSN-key-authenticated ingest (constitution Principle III) — deliberately NOT behind
// sessionAuth or Access. Registered as a sibling to /api/internal, not nested inside it; Hono
// resolves the literal "internal" path segment ahead of the dynamic :projectId segment at the same
// position, and the ingest handler itself defensively rejects project_id "internal" regardless
// (research.md §3, specs/002-error-monitoring). Mounted at "/api" (not "/api/:projectId") so the
// full ":projectId/envelope" pattern is defined directly inside ingestRoutes, rather than relying
// on Hono's cross-router param propagation.
app.route("/api", ingestRoutes);

// sentry-cli-compatible, API-token-authenticated release management (constitution Principle I —
// an extension of the control-plane trust surface's authorization, not a third one; research.md §4,
// specs/005-releases) — the literal "0" path segment takes the same static-before-dynamic
// precedence over ingestRoutes' ":projectId/envelope" pattern that "internal" already does.
app.route("/api/0", releasesCliRoutes);

interface DueCheckRow {
  id: string;
  interval_seconds: number;
}

// specs/006-uptime-monitoring research.md §3 — queries checks whose schedule has come due, runs
// each via runCheck() (constitution Principle V's shared evaluation function, same one
// worker/modules/uptime/routes.ts's interactive trigger route calls), then advances next_run_at.
// Sequential, not parallel: bounded by the 20-checks-per-project cap (research.md §4), so this
// never runs long enough to risk missing the next minute's invocation.
async function runDueUptimeChecks(env: Env): Promise<void> {
  const { results } = await env.DB
    .prepare(`SELECT id, interval_seconds FROM checks WHERE next_run_at <= datetime('now')`)
    .all<DueCheckRow>();

  for (const row of results ?? []) {
    await runCheck(env, row.id, "scheduled");
    await env.DB
      .prepare(
        `UPDATE checks SET next_run_at = datetime('now', '+' || ?2 || ' seconds') WHERE id = ?1`,
      )
      .bind(row.id, row.interval_seconds)
      .run();
  }
}

// Crash-report dialog (constitution Principle III, specs/007-user-feedback) — public,
// DSN-authenticated (via the `dsn` query param, not sessionAuth/Access), matching the real SDK's
// confirmed request shape exactly (research.md §1). No project ID in the path — project resolution
// happens via the embedded DSN. Registered with AND without the trailing slash: the real SDK
// requests the trailing-slash form (`/api/embed/error-page/`, confirmed from Sentry's own source),
// while this project's own contract docs/quickstart curl examples use the bare form — both must
// work, not just whichever this project's own tests happen to exercise.
app.get("/api/embed/error-page", (c) => handleDialogGet(c.req.raw, c.env));
app.get("/api/embed/error-page/", (c) => handleDialogGet(c.req.raw, c.env));
app.post("/api/embed/error-page", (c) => handleDialogPost(c.req.raw, c.env));
app.post("/api/embed/error-page/", (c) => handleDialogPost(c.req.raw, c.env));

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

  // Two independent cron schedules share this one scheduled() export, dispatched by
  // `controller.cron` (specs/006-uptime-monitoring research.md §3) — mirrors the queue() handler's
  // own dispatch-by-name pattern below. Module 6's uptime cron fires every minute and must never be
  // delayed behind the daily retention prune, or vice versa.
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    if (controller.cron === "* * * * *") {
      ctx.waitUntil(runDueUptimeChecks(env));
      return;
    }

    // Daily retention prune (constitution Principle IX, spec FR-015) — deletes events past the
    // default 90-day window (research.md §8); the owning issue's summary row is untouched.
    // specs/003-distributed-tracing research.md §8 extends this to transactions, on their own
    // shorter 30-day window. specs/004-structured-logs research.md §9 extends it further to
    // log_batches, on the shortest window of any module (7 days) — full deletion including the
    // underlying R2 NDJSON object, since a log_batches row is itself the summary.
    // specs/006-uptime-monitoring research.md §5 extends it further to check_runs — `checks`/
    // `incidents` are NOT pruned, low-volume summary/configuration data.
    ctx.waitUntil(
      Promise.all([
        pruneOldEvents(env.DB),
        pruneOldTransactions(env.DB),
        pruneOldLogBatches(env.DB, env.LOGS),
        pruneOldCheckRuns(env.DB),
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
