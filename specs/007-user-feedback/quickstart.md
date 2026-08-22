# Quickstart: User Feedback

## Prerequisites

- Module 1/2 running locally (this module needs the identity/session model and the existing
  `events`/`issues`/`projects` tables — no new Cloudflare bindings).
- This module's migration applied locally: `deno task db:migrations:apply:local` (re-run after
  `0007_user_feedback.sql` is added).
- A project's DSN (seeded demo project from Module 1, DSN-issued in Module 2).

## Validate User Story 1 — widget-based feedback (envelope path)

```sh
curl -X POST "http://127.0.0.1:8787/api/{projectId}/envelope?sentry_key={dsnPublicKey}" \
  -H "Content-Type: application/x-sentry-envelope" \
  --data-binary $'{"event_id":"<uuid>"}\n{"type":"feedback"}\n{"contexts":{"feedback":{"message":"Something looked broken here"}}}\n'
```

Confirm `GET /api/internal/feedback` (session-authenticated) shows the submission with no linked
issue (standalone feedback, Acceptance Scenario 3). Repeat with an invalid `sentry_key` and confirm
`403` with nothing recorded (contracts/feedback-ingest-api.md).

## Validate User Story 2 — crash-report dialog

```sh
# 1. Ingest a real error event first (Module 2's existing path) and note its event_id.
# 2. Load the dialog's GET endpoint (what showReportDialog()'s injected <script> requests):
curl "http://127.0.0.1:8787/api/embed/error-page?dsn=https://{dsnPublicKey}@127.0.0.1:8787/{projectId}&eventId={eventId}"
# Confirm: 200, Content-Type: text/javascript.

# 3. Submit the dialog's own form (what its injected submit handler POSTs):
curl -X POST "http://127.0.0.1:8787/api/embed/error-page?dsn=https://{dsnPublicKey}@127.0.0.1:8787/{projectId}&eventId={eventId}" \
  -d "name=Jane&email=jane@example.com&comments=It crashed after I clicked Save"
```

Confirm the resulting feedback appears in `GET /api/internal/feedback` with `issueId` set to the
issue that `{eventId}`'s event belongs to (contracts/feedback-ingest-api.md, data-model.md). Repeat
the POST with the same `eventId` and confirm it upserts (still exactly one feedback row for that
`(project, eventId)` pair), not two.

## Validate User Story 3 — issue-detail cross-linking

```sh
curl "http://127.0.0.1:8787/api/internal/issues/{issueId}" \
  -H "Cookie: fd_session=<local test session>"
```

Confirm the response's `feedback` array includes the User Story 2 submission. For an issue with no
linked feedback, confirm the array is empty (contracts/feedback-internal-api.md) — the
`IssueDetailScreen.tsx` feedback section renders only when non-empty.

## Real-SDK validation (recommended, not automated)

Configure `@sentry/browser` (>= 7.85.0) with
`Sentry.init({ dsn, integrations:
[Sentry.feedbackIntegration()] })` pointed at a local project's
DSN, and separately call `Sentry.showReportDialog({ eventId })` after a real captured error. Confirm
both the widget submit and the dialog's script-injection + form submission work against this
module's endpoints unmodified — this is the SC-002-grade verification hand-crafted contract tests
alone don't establish (research.md §1).

## Automated test commands

```sh
deno task test              # unit: feedback envelope parsing, associated_event_id resolution, dedup
deno task test:contract     # contract tests against a real wrangler dev
deno task test:e2e           # Feedback list/detail UI flow, issue↔feedback cross-linking
```
