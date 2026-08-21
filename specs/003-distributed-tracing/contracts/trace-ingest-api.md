# Trace Ingest API Contract: Distributed Tracing

Public, DSN-authenticated (constitution Principle III) — no Cloudflare Access, no `fd_session`
cookie. This extends Module 2's existing envelope endpoint; it does not add a new public route.

## `POST /api/{project_id}/envelope` — `"transaction"` items

**Auth**: identical to Module 2's error-ingest contract (`contracts/ingest-api.md` in
specs/002-error-monitoring/) — same `X-Sentry-Auth`/query-string DSN resolution, same fail-closed
`403` behavior, same per-DSN rate limiting (`429` + `X-Sentry-Rate-Limits`). Not re-specified here;
this contract only covers what's new.

**Request body**: same envelope grammar. A `"transaction"`-type item's payload is JSON:

```json
{
  "type": "transaction",
  "event_id": "<sdk event id, for dedup>",
  "start_timestamp": 1735689600.0,
  "timestamp": 1735689600.842,
  "transaction_info": { "source": "route", "transaction": "GET /checkout" },
  "contexts": {
    "trace": {
      "trace_id": "<32 hex chars>",
      "span_id": "<16 hex chars>",
      "parent_span_id": null,
      "op": "http.server",
      "description": "GET /checkout",
      "status": "ok"
    }
  },
  "spans": [
    {
      "span_id": "<16 hex chars>",
      "parent_span_id": "<the transaction's own span_id, or another span's>",
      "op": "db.query",
      "description": "SELECT * FROM carts WHERE id = ?",
      "start_timestamp": 1735689600.1,
      "timestamp": 1735689600.3,
      "status": "ok"
    }
  ]
}
```

An `"event"`-type item in the same or a different envelope is unaffected — Module 2's synchronous
error-ingest path is unchanged, including a new behavior: if that event's own `contexts.trace` is
present, its `trace_id`/`span_id` are extracted and stored on the `events` row (data-model.md), but
this doesn't change that item type's response behavior.

**Behavior**:
1. Rate-limit check (unchanged, Module 2's per-DSN Durable Object) — same as error ingest, checked
   before either item type is processed.
2. DSN resolution (unchanged) — same as error ingest.
3. For a `"transaction"` item: parse it, then `env.TRACE_INGEST.send(parsedTransaction)` — the
   request returns **immediately** on successful enqueue, without writing to D1 in the request path
   (research.md §4). The transaction is NOT yet queryable via the internal API when this response
   returns — see the async-processing note below.
4. The queue consumer (not part of this HTTP contract) later computes `duration_ms`, and writes the
   `transactions` row via `db.batch()`.
5. Payloads beyond the configured maximum size are rejected (reuses Module 2's
   `MAX_ENVELOPE_BYTES`, research.md §2) — the specific limit is an implementation detail, not part
   of this contract's interface shape.

**Response**: `200` on successful enqueue (NOT on successful D1 write — matches real Sentry SDK
expectations the same way Module 2's `200` did, and is also why this endpoint's asynchronous
behavior must be explicit in test design, research.md §9). `403` (auth failure), `429` (rate
limited), `400` (malformed envelope), `413` (payload too large).

**Async-processing note (load-bearing, not incidental)**: a client that receives `200` and
immediately queries `GET /api/internal/traces` (below) may not yet see the transaction —
enqueue-to-queryable latency is bounded by the queue consumer's `max_batch_timeout` (research.md
§4) but is not zero. Any test or integration against this endpoint MUST account for this, unlike
Module 2's error-ingest contract where a `200` response guarantees immediate queryability.

## Non-goals for this contract

- No separate ingest endpoint for transactions — they share Module 2's envelope endpoint by
  Sentry's own protocol design (research.md §2).
- No client-facing way to query queue/delivery status — a `200` is the enqueue acknowledgment, not
  a durability guarantee beyond what Cloudflare Queues itself provides (retries + dead-letter queue,
  research.md §4).
