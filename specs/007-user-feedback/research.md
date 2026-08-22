# Research: User Feedback

Consolidates this session's direct research against Sentry's real source (not just its docs) —
`getsentry/sentry`'s `error_page_embed.py`/`error-page-embed.html` and
`getsentry/sentry-javascript`'s `report-dialog.ts`/`api.ts` — to resolve the one item spec.md's
Assumptions flagged as genuinely open: the crash-report dialog's exact wire shape. Also confirms the
envelope-based widget path's item type and this project's own existing conventions it must extend.

## 1. Crash-report dialog: the full wire shape, confirmed from Sentry's own source

**This was the module's one open research item — now resolved with source-level confidence, not
inferred from docs alone.**

**Client side** (`packages/browser/src/report-dialog.ts`, `packages/core/src/api.ts`,
`getsentry/sentry-javascript`): `Sentry.showReportDialog({ eventId })` does NOT make a `fetch`/XHR
call. It creates a `<script async crossorigin="anonymous">` element, sets its `src` to
`{baseApiEndpoint}embed/error-page/?dsn={dsn}&eventId={eventId}&name={user.name}&email={user.email}&...`
(any other `ReportDialogOptions` key, e.g. `lang`, `title`, are appended verbatim), and appends it
to `document.head`/`document.body`. This is a classic JSONP-style script injection, not a JSON API
call — confirmed directly from source, resolving the "GET query param names" half of spec.md's open
item with certainty (`dsn` and `eventId` are exactly right, `name`/`email` are additional confirmed
optional params for prefill).

**Server side** (`src/sentry/feedback/endpoints/error_page_embed.py`,
`ErrorPageEmbedView.dispatch()`): a single view handles GET, POST, and OPTIONS at the **same URL**
(`/api/embed/error-page/`, no project ID in the path — project resolution happens via the `dsn`
query param, which for this endpoint is the FULL DSN string, e.g.
`https://{key}@{host}/{projectId}`, not just the bare public key `sentry_key` value Module 2's
ingest path expects):

- **GET** (script's own initial load — no `request.POST` body): responds
  `Content-Type:
  text/javascript` with a script body that inlines the dialog's HTML template and
  strings as JSON-in-comment (`"*/" + json.dumps(...) + ";/*"`) for the client-side loader to
  `eval`/render. This is a real, but Sentry-monolith-specific, code-generation trick — FlightDeck
  does not need to replicate it byte-for-bit (see Decision below).
- **POST** (the dialog's own form submission — confirmed from
  `tests/acceptance/test_error_page_embed.py` and the form-handling code): submits back to the
  **exact same URL, query string included** (`request.get_full_path()` is literally what the GET
  response embeds as `endpoint`), with `application/x-www-form-urlencoded` or `multipart/form-data`
  body fields **`name`, `email`, `comments`** (not `message` — this is the dialog's own field
  naming, distinct from the envelope path's `contexts.feedback.message`; FlightDeck's ingest layer
  must map `comments` → the shared `feedback.message` column). Response is JSON: `{}`/200 on
  success, `{"errors": {...}}`/400 on validation failure.
- **Duplicate handling**: a same-`(project_id, event_id)` resubmission hits a DB `IntegrityError`
  and is handled as an **UPSERT** (overwrite the existing row), not a rejected duplicate — this
  directly answers spec.md's Edge Case ("submitted twice... not recorded as two separate entries")
  with a confirmed real-Sentry precedent to follow, not an invented policy.
- **Origin validation**: `is_valid_origin(origin, project)` — a per-project allowed-origins check —
  returns 403 on mismatch. FlightDeck has no per-project allowed-origins configuration concept yet
  (out of scope for this module — see Decision below).
- `@csrf_exempt` — expected and correct, since ingest-style requests carry no CSRF cookie.

**Decision — FlightDeck's own implementation, not a byte-for-bit clone**: since the real SDK never
inspects the GET response's _content_, only that a `<script>` element it injected loads successfully
(`script.onload` fires `onLoad` regardless of the script body) and later receives a
`window.postMessage("__sentry_reportdialog_closed__", ...)` for `onClose` (confirmed from
`report-dialog.ts`'s `reportDialogClosedMessageHandler`), FlightDeck's GET response can be a
self-contained `text/javascript` payload — its own inline styles, a dialog `<div>` injected into
`document.body`, a submit handler that `fetch()`s the same URL (query string preserved) with
`name`/`email`/`comments` as `application/x-www-form-urlencoded` body, and on success
`window.postMessage("__sentry_reportdialog_closed__", window.location.origin)` before removing the
dialog. This achieves full real-SDK compatibility (confirmed script-injection contract + confirmed
`onClose` message contract) without needing Sentry's monolith-specific JSONP-comment rendering
trick, which exists to support Sentry's own server-side-templated dialog customization options
(`title`/`subtitle`/label overrides) — a legitimate but non-essential feature this MVP doesn't need
to replicate. Both the GET path AND the POST path use the exact real query-string/field-name
contract; only the internal rendering mechanism is FlightDeck-original.

**Deferred, explicitly**: per-project allowed-origin configuration (`is_valid_origin`'s real
purpose) is not built this module — the dialog endpoint accepts any Origin. This is a real,
narrower-than-Sentry's-own security posture, named here rather than silently absent; DSN-key
validity (Principle III's existing fail-closed posture, reused unchanged from Module 2) is still the
load-bearing authentication check for this endpoint, exactly as it is for the envelope path.

**Source**: `getsentry/sentry:src/sentry/feedback/endpoints/error_page_embed.py`,
`getsentry/sentry:src/sentry/templates/sentry/error-page-embed.html`,
`getsentry/sentry-javascript:packages/browser/src/report-dialog.ts`,
`getsentry/sentry-javascript:packages/core/src/api.ts` (`getReportDialogEndpoint`).

## 2. Routing: `/api/embed/error-page` is already covered by `run_worker_first`, no wrangler change needed

**Correction to this module's initial framing**: `wrangler.jsonc`'s existing
`assets.run_worker_first` array is `["/login", "/logout", "/api/*"]` (Module 1). Since the real
endpoint path is `/api/embed/error-page/` — already under the `/api/*` wildcard — it is **already**
routed to the Worker, not swept up by the SPA's `not_found_handling: "single-page-application"`
fallback the way `/login` was before that fix landed. No `wrangler.jsonc` change is required this
module, unlike what this module's initial framing assumed. Confirmed by reading the current
`wrangler.jsonc` directly rather than assuming the `/login` bug class recurs unchanged.

## 3. Envelope-based widget path: extends the existing, unmodified pipeline

**Decision**: `worker/modules/ingest/envelope.ts` gains `isFeedbackItem()` (mirroring the existing
`isEventItem()` exactly — `item.header.type === "feedback"`), dispatched in
`worker/modules/ingest/routes.ts`'s existing per-item loop, after the existing `isEventItem`
handling. DSN-key extraction (`extractSentryKey`), rate limiting
(`RATE_LIMITER.idFromName(sentryKey)` — confirmed to already be a single per-key shard with no
category dimension, so "no new rate-limit category" is not a deferred feature but simply consistent
with what the code already does), and project resolution (`resolveProjectByDsnKey`) are reused
completely unchanged — this module adds no new ingest-side authentication code, only a new item-type
branch and its own D1 write.

**`associated_event_id` resolution**: the confirmed `events` table (Module 2) has both `id` (an
internal row ID) and `sdk_event_id` (the SDK's own `event_id`, unique per project). A feedback
item's `associated_event_id` is an SDK-generated `event_id`, so it resolves against
`events.sdk_event_id` (scoped by `project_id`), not `events.id` — the same column the crash-report
dialog's `eventId` query param resolves against. Both paths converge on the same lookup, which is
expected: they are, per Sentry's own architecture, two client entry points into the same underlying
feedback concept.

## 4. Dedup for the envelope path

**Decision**: the confirmed Module 2 dedup pattern
(`SELECT 1 FROM events WHERE project_id = ?1 AND
sdk_event_id = ?2` before insert) is reused for
feedback: a feedback envelope item's own `event_id` field (event-based item type, confirmed from
spec.md's protocol grounding — every event-type envelope item, including `"feedback"`, carries its
own `event_id`) is checked against a new `feedback.sdk_event_id` column before insert, matching
Module 2's own answer to the identical "SDK retry" edge case rather than inventing a different
mechanism for this module.

## 5. Data volume and storage: no new Cloudflare binding

**Decision**: direct D1 writes, no Queue — confirmed appropriate by comparing against Module 5's
`session` item type, which made the same choice for the same reason (one write per real user action,
not a high-frequency telemetry stream; SDK-side batching isn't a factor here the way it is for
Modules 3-4's trace spans/log lines).

**Source**: existing `worker/modules/ingest/envelope.ts`, `routes.ts`, `dsn-auth.ts`; Module 2's
`0002_error_monitoring.sql` (`events.sdk_event_id`, `events.issue_id`).

## 6. Findings from live testing

**The real SDK's dialog request lands on the trailing-slash path** — confirmed live by loading the
actual, unmodified `@sentry/browser` UMD bundle from its real CDN (`browser.sentry-cdn.com`) into a
live Playwright-driven browser and calling `Sentry.showReportDialog({ eventId })`: the injected
`<script>` tag's `src` requests `/api/embed/error-page/` (trailing slash), not the bare
`/api/embed/error-page` this module's own contract docs/quickstart curl examples use. Both forms are
mounted in `worker/index.ts` so neither breaks — the real SDK needs the slash form to work at all,
while this project's own documented curl examples keep working with the bare form. This is exactly
the SC-002-grade confirmation this module's testing strategy called for: a hand-crafted contract
test alone would not have caught this, since it's free to hit whichever path it's told to.

**Two test-fixture bugs, not application bugs**, were caught and fixed while writing the contract
suite — worth recording since both LOOKED like real ingest/upsert bugs at first:

1. The envelope-path dedup contract test initially failed because the test's own
   `buildFeedbackEnvelope()` helper put `event_id` only in the envelope HEADER, not the feedback
   item's own PAYLOAD (unlike `buildErrorEnvelope()` in the same file, which does put it in the
   payload, matching the real protocol) — `insertWidgetFeedback()`'s dedup check correctly reads the
   item's own payload `event_id` (research.md §4), so the test was simply never sending the value it
   claimed to be testing dedup against.
2. The dialog-upsert contract test initially reported 2-then-3 matching rows across repeated runs,
   which looked like the upsert wasn't collapsing to one row — a direct manual reproduction
   (`wrangler
   d1 execute` with the exact same
   `INSERT ... ON CONFLICT ... WHERE source = 'crash_report_dialog'
   DO UPDATE` statement)
   confirmed the upsert logic was correct all along. The real cause: the test used a fixed literal
   comment string across repeated LOCAL test runs against the SAME persistent `wrangler dev` D1
   state, so each run's leftover row (a genuinely different `associated_event_id` per run, since
   that's a fresh UUID each time) accumulated in the message-text-based assertion scan. Fixed by
   embedding the test's own unique title into the submitted comment text, scoping the assertion to
   rows from that specific test run.
