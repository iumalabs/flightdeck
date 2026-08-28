import { assertEquals } from "@std/assert";
import { issuesRoutes } from "../../worker/modules/issues/routes.ts";
import { mintSession } from "../../worker/auth/session.ts";

// issue #126 — GET /api/internal/v1/issues/:id must never 500 just because the (best-effort)
// suspect-commit lookup blew up unexpectedly. This is the belt-and-suspenders call-site guard:
// even if something inside lookupSuspectCommit throws for a reason its own null-returning
// contract doesn't cover, the rest of the issue-detail response must still come back as 200 with
// no suspect commit, not a 500.

const SESSION_SECRET = "test-session-secret-for-issue-detail-suspect-commit-guard";
const TEST_ENV = {
  SESSION_SECRET,
  GITHUB_APP_ID: "app-123",
  GITHUB_APP_PRIVATE_KEY: "not-a-real-pem",
};

const PROJECT_ROW = { id: "1", name: "Test Project" };
const ISSUE_ROW = {
  id: "issue-1",
  project_id: "1",
  title: "TypeError: boom",
  culprit: "useCheckout",
  level: "error",
  event_count: 3,
  first_seen: "2026-08-01T00:00:00Z",
  last_seen: "2026-08-02T00:00:00Z",
  status: "unresolved",
  resolved_release_id: null,
};

const EVENT_PAYLOAD = {
  exception: {
    values: [{
      type: "TypeError",
      value: "boom",
      stacktrace: {
        frames: [
          { filename: "CartSummary.tsx", function: "useCheckout", in_app: true },
        ],
      },
    }],
  },
};

class FakeD1 {
  prepare = (sql: string) => {
    const first = <T>() => {
      if (sql.startsWith("SELECT CAST(id AS TEXT) AS id, name FROM projects")) {
        return Promise.resolve(PROJECT_ROW as unknown as T);
      }
      if (sql.startsWith("SELECT id, project_id, title")) {
        return Promise.resolve(ISSUE_ROW as unknown as T);
      }
      if (sql.startsWith("SELECT payload, trace_id FROM events")) {
        return Promise.resolve(
          { payload: JSON.stringify(EVENT_PAYLOAD), trace_id: null } as unknown as T,
        );
      }
      if (sql.startsWith("SELECT owner, repo, installation_id FROM repository_connections")) {
        // Simulates an unexpected failure somewhere inside the suspect-commit lookup path
        // (e.g. a transient D1 error) — NOT one of lookupSuspectCommit's own documented
        // null-returning branches. Proves the call-site try/catch is real defense in depth,
        // independent of the root-cause fix in suspect-commit.ts.
        throw new Error("simulated D1 failure");
      }
      return Promise.resolve(undefined as unknown as T);
    };
    const all = <T>() => Promise.resolve({ results: [] as T[] });
    return {
      first,
      all,
      bind: (..._args: unknown[]) => ({ first, all }),
    };
  };
}

async function sessionCookieHeader(): Promise<string> {
  const token = await mintSession(
    { sub: "user-1", email: "user@example.com", role: "member" },
    { SESSION_SECRET },
  );
  return `fd_session=${token}`;
}

Deno.test("GET /:id still returns 200 with no suspect commit when the suspect-commit lookup throws unexpectedly", async () => {
  const db = new FakeD1();
  const res = await issuesRoutes.request(
    "/issue-1",
    { headers: { Cookie: await sessionCookieHeader() } },
    { ...TEST_ENV, DB: db },
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { suspectCommit: unknown; id: string; title: string };
  assertEquals(body.suspectCommit, null);
  assertEquals(body.id, "issue-1");
  assertEquals(body.title, "TypeError: boom");
});
