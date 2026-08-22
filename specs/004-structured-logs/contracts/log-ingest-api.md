# Log Ingest API Contract: Structured Logs

Public, DSN-authenticated (constitution Principle III) — no Cloudflare Access, no `fd_session`
cookie. This extends Modules 2-3's existing envelope endpoint; it does not add a new public route.

## `POST /api/{project_id}/envelope` — `"log"` items

**Auth**: identical to Modules 2-3's contracts — same DSN resolution, same fail-closed `403`. Not
re-specified here.

**Rate limiting**: independently keyed from error/transaction ingest (research.md §3) — a burst of
log traffic returns `429` + `X-Sentry-Rate-Limits: {retry_after}:log_item:key` (the specific,
Sentry-documented `log_item` category, not the empty-categories-means-all form Module 2's MVP used)
without affecting that project's error/transaction rate-limit budget, and vice versa.

**Request body**: same envelope grammar. A `"log"`-type item's payload is JSON:

```json
{
  "items": [
    {
      "timestamp": 1735689600.123,
      "trace_id": "<32 hex chars>",
      "span_id": "<16 hex chars, optional>",
      "level": "info",
      "body": "user checkout completed",
      "severity_number": 9,
      "attributes": {
        "user.id": { "value": "usr_123", "type": "string" },
        "order.total": { "value": 42.5, "type": "double" }
      }
    }
  ]
}
```

Up to 100 items per envelope submission (Sentry's own SDK-side cap, research.md §1) — FlightDeck
does not need to separately enforce a lower count limit, only the existing `MAX_ENVELOPE_BYTES`
overall payload-size guard (reused unchanged from Module 2).

**Behavior**:
1. Rate-limit check against the `` `${dsnKey}:log` ``-keyed `RateLimiter` DO instance (independent
   window, research.md §3).
2. DSN resolution (unchanged).
3. Parse the batched `items` array.
4. `env.LOG_INGEST.send(parsedBatch)` — pushes the WHOLE array as one queue message.
5. In parallel (not awaited before step 4's response), call the project's `LiveTail` Durable Object
   to broadcast the new records to any connected live-tail WebSocket viewers (research.md §7).
6. Return `200` immediately — matches the same "enqueue acknowledgment, not durability guarantee"
   semantics as Module 3's transaction-ingest contract. A client that receives `200` and
   immediately searches may not yet find the content — search/trace-lookup queryability lags
   ingest by the queue consumer's flush interval, same async-processing caveat Module 3's
   trace-ingest contract documents.

**Response**: `200` (enqueued — both the durable-storage path and the live-tail broadcast are
triggered), `403` (auth failure), `429` (rate limited, `log_item` category), `400` (malformed
envelope), `413` (payload too large).

## Non-goals for this contract

- No separate ingest endpoint for logs — they share the existing envelope endpoint by Sentry's own
  protocol design (research.md §1-2), exactly like Module 3's transactions.
- No per-line ingest acknowledgment — the `200` response covers the whole batched submission, not
  individual log lines within it (matching how a single envelope submission is one unit of
  acceptance, per protocol).
