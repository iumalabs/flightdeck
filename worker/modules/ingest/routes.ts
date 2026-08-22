import { Hono } from "hono";
import { extractSentryKey, resolveProjectByDsnKey } from "./dsn-auth.ts";
import {
  isEventItem,
  isTransactionItem,
  parseEnvelope,
  parseEventPayload,
  parseTransactionPayload,
} from "./envelope.ts";
import { computeFingerprint, deriveCulprit, deriveTitle } from "./fingerprint.ts";
import { resolveStackTrace } from "./sourcemap.ts";
import { extractTraceContext } from "./trace-context.ts";
import type { EventPayload } from "./types.ts";
import type { QueuedTransaction } from "./trace-consumer.ts";
import type { RateLimiter } from "../../durable-objects/rate-limiter.ts";

interface Env {
  DB: D1Database;
  SOURCE_MAPS: R2Bucket;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  TRACE_INGEST: Queue<QueuedTransaction>;
}

// "transaction" item shape (specs/003-distributed-tracing research.md §2) — loose/optional like
// EventPayload, since only the fields this module actually reads are validated.
interface TransactionPayload {
  event_id?: string;
  start_timestamp?: number;
  timestamp?: number;
  transaction_info?: { transaction?: string };
  transaction?: string;
  contexts?: { trace?: { trace_id?: string; op?: string } };
  spans?: unknown[];
}

// Max ingest payload size (spec FR-013) — generous enough for a real stack trace + breadcrumbs +
// vars dump, small enough that one oversized submission can't degrade ingest for other projects.
const MAX_ENVELOPE_BYTES = 1_000_000; // 1 MB

export const ingestRoutes = new Hono<{ Bindings: Env }>();

ingestRoutes.post("/:projectId/envelope", async (c) => {
  const projectId = c.req.param("projectId");
  // "internal" is reserved (research.md §3) — never resolves as a project, checked before any DSN
  // lookup regardless of Hono's own static-before-dynamic route precedence.
  if (projectId === "internal") {
    return c.text("Forbidden", 403);
  }

  // Step 1: extract the DSN key. Fail closed with no DB/DO call if it's simply absent/mismatched —
  // there is nothing valid to rate-limit or look up (constitution Principle III).
  const sentryKey = extractSentryKey(c.req.raw);
  if (!sentryKey) {
    return c.text("Forbidden", 403);
  }

  // Step 2: rate limit, sharded per raw DSN key (research.md §4) — before touching D1, so a
  // throttled project's traffic never reaches the database at all.
  const limiterId = c.env.RATE_LIMITER.idFromName(sentryKey);
  const limiter = c.env.RATE_LIMITER.get(limiterId);
  const { allowed, retryAfterSeconds } = await limiter.checkAndIncrement();
  if (!allowed) {
    return c.text("Too Many Requests", 429, {
      "X-Sentry-Rate-Limits": `${retryAfterSeconds}::key`,
    });
  }

  // Step 3: resolve the key against this specific project. Fail closed on any mismatch.
  const project = await resolveProjectByDsnKey(c.env.DB, projectId, sentryKey);
  if (!project) {
    return c.text("Forbidden", 403);
  }

  const bodyBuffer = await c.req.arrayBuffer();
  if (bodyBuffer.byteLength > MAX_ENVELOPE_BYTES) {
    return c.text("Payload Too Large", 413);
  }

  const envelope = parseEnvelope(new Uint8Array(bodyBuffer));
  if (!envelope) {
    return c.text("Bad Request", 400);
  }

  for (const item of envelope.items) {
    if (isTransactionItem(item)) {
      // Trace ingest is asynchronous (specs/003-distributed-tracing research.md §4) — enqueue and
      // move on, never a synchronous D1 write in this request path (unlike the "event" branch
      // below, unchanged from Module 2).
      const transaction = parseTransactionPayload(item) as TransactionPayload | null;
      const traceId = transaction?.contexts?.trace?.trace_id;
      if (
        !transaction || !transaction.event_id || !traceId ||
        typeof transaction.start_timestamp !== "number" || typeof transaction.timestamp !== "number"
      ) {
        continue; // an unparseable/incomplete transaction item is dropped, not fatal to the rest of the envelope
      }

      const queued: QueuedTransaction = {
        projectId: project.id,
        traceId,
        sdkEventId: transaction.event_id,
        name: transaction.transaction_info?.transaction ?? transaction.transaction ?? "unknown",
        op: transaction.contexts?.trace?.op ?? null,
        startTimestamp: transaction.start_timestamp,
        timestamp: transaction.timestamp,
        spans: transaction.spans ?? [],
      };
      await c.env.TRACE_INGEST.send(queued);
      continue;
    }

    if (!isEventItem(item)) continue; // other item types are accepted-and-skipped (research.md §2)

    const event = parseEventPayload(item) as EventPayload | null;
    if (!event || !event.event_id) continue; // an unparseable/incomplete event item is dropped, not fatal to the rest of the envelope

    // Dedup check (spec FR-014) happens before any issue mutation, per research.md §9's note on
    // D1's write pattern — a retried submission of the same sdk_event_id is a no-op.
    const existing = await c.env.DB
      .prepare(`SELECT 1 FROM events WHERE project_id = ?1 AND sdk_event_id = ?2`)
      .bind(project.id, event.event_id)
      .first();
    if (existing) continue;

    // Source-map resolution runs BEFORE fingerprinting (research.md §5) — a no-op stub until User
    // Story 3, but the call site is already in the correct pipeline position.
    const exceptionValue = event.exception?.values?.at(-1);
    if (exceptionValue?.stacktrace?.frames) {
      exceptionValue.stacktrace.frames = await resolveStackTrace(
        c.env.DB,
        c.env.SOURCE_MAPS,
        project.id,
        event.release,
        exceptionValue.stacktrace.frames,
      );
    }

    const fingerprint = computeFingerprint(event);
    const title = deriveTitle(event);
    const culprit = deriveCulprit(event);
    const level = event.level ?? "error";

    const issue = await c.env.DB
      .prepare(
        `INSERT INTO issues (id, project_id, fingerprint, title, culprit, level, event_count, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, datetime('now'), datetime('now'))
         ON CONFLICT(project_id, fingerprint) DO UPDATE SET
           event_count = event_count + 1,
           last_seen = datetime('now')
         RETURNING id`,
      )
      .bind(crypto.randomUUID(), project.id, fingerprint, title, culprit, level)
      .first<{ id: string }>();

    if (!issue) continue; // shouldn't happen — defensive, don't let one bad item 500 the request

    // contexts.trace is the same context object transactions carry (specs/003-distributed-tracing
    // research.md §3) — recorded here whether or not a transaction for this trace was ever
    // ingested, per Sentry's own "recommended... even without performance monitoring" guidance.
    const traceContext = extractTraceContext(event);

    await c.env.DB
      .prepare(
        `INSERT INTO events (id, issue_id, project_id, sdk_event_id, release, environment, payload, trace_id, span_id, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))`,
      )
      .bind(
        crypto.randomUUID(),
        issue.id,
        project.id,
        event.event_id,
        event.release ?? null,
        event.environment ?? null,
        JSON.stringify(event),
        traceContext?.traceId ?? null,
        traceContext?.spanId ?? null,
      )
      .run();
  }

  return c.text("", 200);
});
