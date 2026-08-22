# Ingest API Contract: User Feedback

Two distinct public, DSN-authenticated ingest surfaces (constitution Principle I/III) — the existing
envelope endpoint gains a new item type, and a genuinely new HTML/JS-serving endpoint is added for
the crash-report dialog. Neither sits behind Cloudflare Access.

## `POST /api/{projectId}/envelope` — feedback envelope item (extends Module 2's existing route)

No new route. The existing handler (`worker/modules/ingest/routes.ts`) gains a new item-type branch,
reusing DSN-key extraction, rate limiting, and project resolution unchanged (research.md §3).

**Item header**: `{"type": "feedback"}`.

**Item payload** (`event.contexts.feedback`):

```json
{
  "message": "string (required)",
  "name": "string?",
  "contact_email": "string?",
  "url": "string?",
  "source": "string? (developer-provided; ignored — FlightDeck's own `source` column is set to `\"widget\"` for this path, not read from this field)",
  "associated_event_id": "string? (an existing event's sdk_event_id)"
}
```

Also reads the item's own top-level `event_id` (event-based item, spec.md protocol grounding) for
dedup (research.md §4).

**Behavior**:

- Missing/unrecognized DSN key → `403`, nothing recorded (FR-002, unchanged Principle III behavior).
- Missing `message` → the item is dropped (not fatal to the rest of the envelope), matching Module
  2's existing "unparseable/incomplete event item is dropped, not fatal" posture for its own `event`
  items.
- `associated_event_id` present but doesn't resolve against `events.sdk_event_id` in this project →
  feedback is still recorded, `issue_id` stays NULL (FR-006, Edge Case).
- Item's own `event_id` already seen for this project → no-op (FR-009, research.md §4).
- Oversized envelope → rejected before any item is parsed (FR-010, existing `MAX_ENVELOPE_BYTES`
  check, unchanged).

**Response**: identical shape to Module 2's existing envelope response — this item type never
changes the endpoint's overall response contract.

## `GET|POST /api/embed/error-page` — crash-report dialog (new)

Matches the real Sentry SDK's confirmed request shape exactly (research.md §1) — no project ID in
the path; the DSN (public key + project ID) is carried in the `dsn` query parameter.

### `GET /api/embed/error-page?dsn={dsn}&eventId={eventId}&name={name}&email={email}`

**Query parameters**:

- `dsn` (required) — the full DSN string, `https://{public_key}@{host}/{projectId}`.
- `eventId` (required) — the `event_id` of the error this feedback is about.
- `name`, `email` (optional) — prefill values, taken from the SDK's current scope user.

**Behavior**:

- `dsn` missing/malformed, or its embedded public key + project ID don't resolve to an active
  project → `404`, no HTML/JS served (Principle III's fail-closed posture, applied here the same way
  it applies to the envelope path).
- `eventId` missing → `400`.
- Otherwise → `200`, `Content-Type: text/javascript`, a self-contained script that injects the
  dialog UI into `document.body` and wires its submit handler to POST back to this same URL
  (research.md §1's Decision — FlightDeck-original rendering, real-SDK-compatible contract).

**Response is not JSON** — this is the one ingest surface in the project that serves executable
script content rather than a JSON API response, by protocol necessity (research.md §1).

### `POST /api/embed/error-page?dsn={dsn}&eventId={eventId}` (same URL, query string preserved)

**Body** (`application/x-www-form-urlencoded`): `name`, `email`, `comments` (required) — the
dialog's own field names (research.md §1), mapped internally to `Feedback.name`/`contact_email`/
`message`.

**Behavior**:

- Same `dsn`/`eventId` validation as GET.
- `comments` missing/empty → `400`, `{"errors": {"comments": "..."}}`.
- Valid submission → upserted on `(project_id, associated_event_id, source='crash_report_dialog')`
  (data-model.md, research.md §1) — a retried submission overwrites rather than duplicating.
  `issue_id` resolved against `events.sdk_event_id = eventId` for this project.
- Success response: `200`, `{}`.

**Response `403`**: reserved for a future per-project allowed-origin check (research.md §1) — not
enforced this module; DSN validity is the load-bearing check for MVP.
