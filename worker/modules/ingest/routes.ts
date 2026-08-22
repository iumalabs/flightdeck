import { Hono } from "hono";
import { extractSentryKey, resolveProjectByDsnKey } from "./dsn-auth.ts";
import {
  isEventItem,
  isLogItem,
  isSessionItem,
  isTransactionItem,
  parseEnvelope,
  parseEventPayload,
  parseLogPayload,
  parseSessionPayload,
  parseTransactionPayload,
} from "./envelope.ts";
import { computeFingerprint, deriveCulprit, deriveTitle } from "./fingerprint.ts";
import { resolveStackTrace } from "./sourcemap.ts";
import { extractTraceContext } from "./trace-context.ts";
import {
  extractSessionOutcomes,
  foldOutcomesIntoCounters,
  shouldTrackDistinctUser,
} from "./release-health.ts";
import { findNextReleaseAfter, resolveOrCreateRelease } from "./release-lookup.ts";
import { isRegression } from "./regression.ts";
import type { EventPayload } from "./types.ts";
import type { QueuedTransaction } from "./trace-consumer.ts";
import type { QueuedLogBatch, RawLogRecord } from "./log-consumer.ts";
import { normalizeRecord } from "./log-consumer.ts";
import type { RateLimiter } from "../../durable-objects/rate-limiter.ts";
import type { LiveTail } from "../../durable-objects/live-tail.ts";

interface Env {
  DB: D1Database;
  SOURCE_MAPS: R2Bucket;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  LIVE_TAIL: DurableObjectNamespace<LiveTail>;
  TRACE_INGEST: Queue<QueuedTransaction>;
  LOG_INGEST: Queue<QueuedLogBatch>;
}

// "log" item shape (specs/004-structured-logs research.md §1) — a `"log"`-type item batches many
// independent records inside its own `items` array, a materially different shape from
// one-record-per-item "event"/"transaction".
interface LogItemPayload {
  items?: RawLogRecord[];
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

  const bodyBuffer = await c.req.arrayBuffer();
  if (bodyBuffer.byteLength > MAX_ENVELOPE_BYTES) {
    return c.text("Payload Too Large", 413);
  }

  const envelope = parseEnvelope(new Uint8Array(bodyBuffer));
  if (!envelope) {
    return c.text("Bad Request", 400);
  }

  // Rate limiting (research.md §4/specs/002; §3/specs/004-structured-logs) is checked per
  // item-type CATEGORY present in this envelope, not once for the whole request — logs get their
  // own independently-keyed budget (`${dsnKey}:log`) so a burst of log traffic can never exhaust
  // the same counter that protects error/transaction ingestion, and vice versa (spec SC-004). An
  // envelope mixing categories checks each relevant limiter independently; either one denying is
  // enough to reject the whole request (simpler and safer than partially processing an envelope).
  const hasLogItem = envelope.items.some(isLogItem);
  const hasOtherItem = envelope.items.some((item) => isEventItem(item) || isTransactionItem(item));

  if (hasOtherItem) {
    const limiter = c.env.RATE_LIMITER.get(c.env.RATE_LIMITER.idFromName(sentryKey));
    const { allowed, retryAfterSeconds } = await limiter.checkAndIncrement();
    if (!allowed) {
      return c.text("Too Many Requests", 429, {
        "X-Sentry-Rate-Limits": `${retryAfterSeconds}::key`,
      });
    }
  }
  if (hasLogItem) {
    const logLimiter = c.env.RATE_LIMITER.get(c.env.RATE_LIMITER.idFromName(`${sentryKey}:log`));
    const { allowed, retryAfterSeconds } = await logLimiter.checkAndIncrement();
    if (!allowed) {
      return c.text("Too Many Requests", 429, {
        "X-Sentry-Rate-Limits": `${retryAfterSeconds}:log_item:key`,
      });
    }
  }

  // Resolve the key against this specific project. Fail closed on any mismatch.
  const project = await resolveProjectByDsnKey(c.env.DB, projectId, sentryKey);
  if (!project) {
    return c.text("Forbidden", 403);
  }

  for (const item of envelope.items) {
    if (isLogItem(item)) {
      // Durable storage (queue) and live-tail broadcast happen IN PARALLEL, not sequentially
      // (specs/004-structured-logs research.md §7) — live tail must not wait on the queue
      // consumer's own batched write.
      const logItem = parseLogPayload(item) as LogItemPayload | null;
      const records = (logItem?.items ?? []).filter(
        (record): record is RawLogRecord =>
          typeof record?.timestamp === "number" && typeof record?.level === "string" &&
          typeof record?.body === "string",
      );
      if (records.length === 0) continue; // an unparseable/empty log item is dropped, not fatal

      const liveTailStub = c.env.LIVE_TAIL.get(c.env.LIVE_TAIL.idFromName(project.id));
      await Promise.all([
        c.env.LOG_INGEST.send({ projectId: project.id, records }),
        liveTailStub.broadcast(records.map(normalizeRecord)),
      ]);
      continue;
    }

    if (isSessionItem(item)) {
      // Direct D1 writes, no Queue (research.md §5) — server-mode SDKs pre-aggregate before
      // sending, keeping request volume comparable to Module 2's error ingest, not Module 3/4's
      // higher-volume surfaces.
      const payload = parseSessionPayload(item);
      if (!payload) continue;

      const itemType = item.header.type === "session" ? "session" : "sessions";
      const outcomes = extractSessionOutcomes(itemType, payload);
      const buckets = foldOutcomesIntoCounters(outcomes);

      for (const bucket of buckets.values()) {
        const release = await resolveOrCreateRelease(c.env.DB, project.id, bucket.release);
        await c.env.DB
          .prepare(
            `INSERT INTO release_health
               (project_id, release_id, environment, date, sessions_total, sessions_crashed, sessions_errored)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(project_id, release_id, environment, date) DO UPDATE SET
               sessions_total = sessions_total + ?5,
               sessions_crashed = sessions_crashed + ?6,
               sessions_errored = sessions_errored + ?7`,
          )
          .bind(
            project.id,
            release.id,
            bucket.environment,
            bucket.date,
            bucket.sessionsTotal,
            bucket.sessionsCrashed,
            bucket.sessionsErrored,
          )
          .run();
      }

      // Distinct-user tracking (research.md §6) — only "session" (singular) items carry a `did`;
      // capped per (project, release, environment, date) bucket, checked before each insert.
      for (const outcome of outcomes) {
        if (!outcome.did) continue;
        const release = await resolveOrCreateRelease(c.env.DB, project.id, outcome.release);
        const { count } = await c.env.DB
          .prepare(
            `SELECT COUNT(*) as count FROM release_health_users
             WHERE project_id = ?1 AND release_id = ?2 AND environment = ?3 AND date = ?4`,
          )
          .bind(project.id, release.id, outcome.environment, outcome.date)
          .first<{ count: number }>() ?? { count: 0 };
        if (!shouldTrackDistinctUser(count)) continue;

        await c.env.DB
          .prepare(
            `INSERT INTO release_health_users (project_id, release_id, environment, date, did, crashed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(project_id, release_id, environment, date, did) DO UPDATE SET
               crashed = MAX(crashed, ?6)`,
          )
          .bind(
            project.id,
            release.id,
            outcome.environment,
            outcome.date,
            outcome.did,
            outcome.status === "crashed" ? 1 : 0,
          )
          .run();
      }
      continue;
    }

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
         RETURNING id, status, resolved_release_id, resolved_mode`,
      )
      .bind(crypto.randomUUID(), project.id, fingerprint, title, culprit, level)
      .first<
        {
          id: string;
          status: string;
          resolved_release_id: string | null;
          resolved_mode: string | null;
        }
      >();

    if (!issue) continue; // shouldn't happen — defensive, don't let one bad item 500 the request

    // specs/005-releases research.md §7: a resolved issue automatically reopens when a later
    // release's occurrence arrives — extends this existing "event" path, not a new endpoint/job.
    if (
      issue.status === "resolved" && issue.resolved_release_id && event.release &&
      (issue.resolved_mode === "exact" || issue.resolved_mode === "next-release")
    ) {
      const resolvedReleaseRow = await c.env.DB
        .prepare(`SELECT id, created_at FROM releases WHERE id = ?1`)
        .bind(issue.resolved_release_id)
        .first<{ id: string; created_at: string }>();
      const newEventReleaseRow = await resolveOrCreateRelease(c.env.DB, project.id, event.release);

      if (resolvedReleaseRow) {
        const resolvedRelease = {
          id: resolvedReleaseRow.id,
          createdAt: resolvedReleaseRow.created_at,
        };
        const newEventRelease = {
          id: newEventReleaseRow.id,
          createdAt: newEventReleaseRow.created_at,
        };
        const nextReleaseRow = issue.resolved_mode === "next-release"
          ? await findNextReleaseAfter(c.env.DB, project.id, resolvedReleaseRow.created_at)
          : null;
        const nextRelease = nextReleaseRow
          ? { id: nextReleaseRow.id, createdAt: nextReleaseRow.created_at }
          : null;
        const regressed = isRegression(
          issue.resolved_mode,
          resolvedRelease,
          nextRelease,
          newEventRelease,
        );
        if (regressed) {
          await c.env.DB
            .prepare(`UPDATE issues SET status = 'unresolved' WHERE id = ?1`)
            .bind(issue.id)
            .run();
        }
      }
    }

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
