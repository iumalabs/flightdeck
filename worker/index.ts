import { Hono } from "hono";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  CF_ACCOUNT_ID: string;
}

const app = new Hono<{ Bindings: Env }>();

// Routes are added under /api/internal/* by later modules (see worker/auth/access-jwt.ts and
// worker/modules/identity/routes.ts) — this file stays the single fetch entrypoint per
// constitution Principle V (single Worker) and doesn't grow route logic of its own.

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { app };
