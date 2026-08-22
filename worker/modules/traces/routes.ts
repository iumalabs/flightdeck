import { Hono } from "hono";
import { sessionAuth } from "../../auth/session.ts";
import type { SessionIdentity } from "../../auth/session.ts";
import { fetchPercentile, operationsListSql } from "../ingest/percentiles.ts";
import type { RawSpan } from "../ingest/waterfall-layout.ts";
import { extractMatchingLines } from "../logs/extract.ts";

interface Env {
  DB: D1Database;
  LOGS: R2Bucket;
}

export const tracesRoutes = new Hono<
  { Bindings: Env; Variables: { identity: SessionIdentity } }
>();

tracesRoutes.use("*", sessionAuth);

interface OperationRow {
  name: string;
  op: string | null;
  count: number;
  latest_id: string;
}

// contracts/traces-internal-api.md's GET /api/internal/traces — grouped by operation name, with
// on-demand p50/p95 (research.md §7) over the trailing 24h window; an operation with zero
// transactions in that window is simply absent, not shown with zeroed figures.
tracesRoutes.get("/", async (c) => {
  // Module 1/2's single-seeded-project caveat, unchanged (contracts/traces-internal-api.md's
  // Non-goals) — explicitly scoped by project_id (unlike Module 2's issues list, which has no
  // filter at all) since data-model.md's indexes are keyed on (project_id, name, started_at); a
  // real project selector is a later module's concern.
  const projectId = "demo";
  const { results } = await c.env.DB
    .prepare(operationsListSql())
    .bind(projectId)
    .all<OperationRow>();

  const operations = await Promise.all(
    (results ?? []).map(async (row) => {
      const [p50Ms, p95Ms] = await Promise.all([
        fetchPercentile(c.env.DB, projectId, row.name, 0.50),
        fetchPercentile(c.env.DB, projectId, row.name, 0.95),
      ]);
      return {
        name: row.name,
        op: row.op,
        p50Ms: p50Ms ?? 0,
        p95Ms: p95Ms ?? 0,
        count: row.count,
        latestTransactionId: row.latest_id,
      };
    }),
  );

  return c.json({ operations });
});

// contracts/traces-internal-api.md's addition — GET /api/internal/traces/by-trace-id/{traceId},
// the resolution step this contract's own text describes ("resolving it to a specific transaction
// detail page requires a lookup by trace_id... not a direct id match") but had left unspecified as
// a distinct route when originally written. Hono resolves the literal "by-trace-id" static segment
// ahead of the dynamic ":id" segment at the same position regardless of registration order (the
// same precedence ingest/routes.ts's "internal" project_id guard already relies on).
tracesRoutes.get("/by-trace-id/:traceId", async (c) => {
  const traceId = c.req.param("traceId");
  const row = await c.env.DB
    .prepare(`SELECT id FROM transactions WHERE trace_id = ?1 LIMIT 1`)
    .bind(traceId)
    .first<{ id: string }>();
  return c.json({ transactionId: row?.id ?? null });
});

interface TransactionRow {
  id: string;
  project_id: string;
  trace_id: string;
  name: string;
  op: string | null;
  duration_ms: number;
  start_timestamp: number;
  started_at: string;
  spans_json: string;
}

interface LinkedErrorRow {
  issue_id: string;
  title: string;
  level: string;
}

// contracts/traces-internal-api.md's GET /api/internal/traces/{id} — {id} is transactions.id, not
// the raw trace_id (mirrors Module 2's issues.id-keyed detail route). linkedErrors is [] rather
// than omitted when no error shares this transaction's trace_id (spec FR-009's "absent, not an
// error state").
tracesRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const transaction = await c.env.DB
    .prepare(
      `SELECT id, project_id, trace_id, name, op, duration_ms, start_timestamp, started_at, spans_json
       FROM transactions WHERE id = ?1`,
    )
    .bind(id)
    .first<TransactionRow>();

  if (!transaction) {
    return c.text("Not Found", 404);
  }

  let spans: RawSpan[] = [];
  try {
    spans = JSON.parse(transaction.spans_json) as RawSpan[];
  } catch {
    spans = []; // malformed spans_json never fails the whole transaction view (spec.md Edge Cases)
  }

  const { results: linkedErrors } = await c.env.DB
    .prepare(
      `SELECT DISTINCT issues.id AS issue_id, issues.title, issues.level
       FROM events JOIN issues ON events.issue_id = issues.id
       WHERE events.project_id = ?1 AND events.trace_id = ?2`,
    )
    .bind(transaction.project_id, transaction.trace_id)
    .all<LinkedErrorRow>();

  // contracts/logs-internal-api.md's addition (specs/004-structured-logs) — resolved via
  // log_batch_traces then the same read-time R2 extraction search uses (research.md §6 there).
  const { results: logBatches } = await c.env.DB
    .prepare(
      `SELECT lb.r2_object_key FROM log_batch_traces lbt
       JOIN log_batches lb ON lb.id = lbt.batch_id
       WHERE lbt.trace_id = ?1`,
    )
    .bind(transaction.trace_id)
    .all<{ r2_object_key: string }>();
  const logs = (
    await Promise.all(
      (logBatches ?? []).map((batch) =>
        extractMatchingLines(c.env.LOGS, batch.r2_object_key, { traceId: transaction.trace_id })
      ),
    )
  ).flat();

  return c.json({
    id: transaction.id,
    traceId: transaction.trace_id,
    name: transaction.name,
    op: transaction.op,
    durationMs: transaction.duration_ms,
    startedAt: transaction.started_at,
    startTimestamp: transaction.start_timestamp,
    spans: spans.map((span) => ({
      spanId: span.span_id,
      parentSpanId: span.parent_span_id ?? null,
      op: span.op ?? null,
      description: span.description ?? null,
      startTimestamp: span.start_timestamp,
      timestamp: span.timestamp,
      status: span.status ?? null,
    })),
    linkedErrors: (linkedErrors ?? []).map((row) => ({
      issueId: row.issue_id,
      title: row.title,
      level: row.level,
    })),
    logs: logs.map((line) => ({
      timestamp: line.timestamp,
      level: line.level,
      body: line.body,
    })),
  });
});
