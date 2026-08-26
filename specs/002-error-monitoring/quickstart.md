# Quickstart: Error Monitoring

## Prerequisites

- Module 1 running locally (`deno task db:migrations:apply:local`, `deno task dev` — see
  `specs/001-landing-access-login/quickstart.md`).
- This module's migration applied locally: `deno task db:migrations:apply:local` (re-run after
  `0002_error_monitoring.sql` is added).
- A GitHub App registered (for User Story 4 only) with its App ID/private key available as local
  dev vars — not required to validate User Stories 1–3.

## Validate User Story 1 — ingest & grouped issues

```sh
# Look up the demo project's DSN (seeded by this module's migration)
deno run -A npm:wrangler d1 execute flightdeck-production --local \
  --command "SELECT id, dsn_public_key FROM projects WHERE id = 1"
```

Configure a real `@sentry/browser` (or `@sentry/react`) instance and a real Python `sentry-sdk`
instance, each with `dsn: "http://<public_key>@127.0.0.1:8787/1"` (local dev — no TLS), trigger a
captured exception from each, and confirm both appear in `GET /api/internal/issues` (or the Issues
screen in the browser) as separate issues with `eventCount: 1`. Trigger the JS error a second time
and confirm the existing issue's `eventCount` becomes 2, not a new issue.

Contract-level alternative (no real SDK install needed): hand-craft an envelope body matching
`contracts/ingest-api.md`'s grammar and `curl` it directly at
`http://127.0.0.1:8787/api/1/envelope/?sentry_key=<key>&sentry_version=7`.

## Validate User Story 2 — issue detail

```sh
curl http://127.0.0.1:8787/api/internal/issues -H "Cookie: fd_session=<local test session>"
curl http://127.0.0.1:8787/api/internal/issues/<id> -H "Cookie: fd_session=<local test session>"
```

Confirm the stack trace, breadcrumbs, and tags/context recorded by whichever SDK triggered it in
User Story 1 are all present in the response.

## Validate User Story 3 — source map resolution

1. Build a minified JS bundle with a real source map from any small test project.
2. Trigger an error from the minified bundle against the demo project's DSN.
3. Upload the source map: `POST /api/internal/projects/1/source-maps` (multipart: `release`,
   `minifiedPathPattern`, `file`).
4. Re-fetch the issue's detail and confirm the stack trace now shows original file/function/line,
   not the minified equivalent — without re-triggering the error.

## Validate User Story 4 — suspect commits

1. Complete a GitHub App installation against a real (test) repository.
2. `POST /api/internal/projects/1/github/connect` with the resulting installation id/owner/repo.
3. Trigger an error whose culprit frame's file path exists in that repository.
4. Confirm the issue detail's `suspectCommit` field names the actual most recent commit that
   touched that file.

## Automated test commands

```sh
deno task test              # unit: envelope, fingerprint, dsn-auth, sourcemap-resolve, github-app-auth
deno task test:contract     # contract tests against a real wrangler dev
deno task test:e2e           # issue-list → issue-detail UI flow
```

## Validation results (2026-08-22)

Run against a real `wrangler dev --env preview` instance (contract/e2e tiers) plus Deno's test
runtime (unit tier). All four automated suites pass: `deno task test` (57 tests), `deno task
test:contract` (7 tests), `deno task test:e2e` (12 tests), and `deno task build`.

- **User Story 1 (ingest & grouped issues)**: validated via the contract-level alternative —
  `tests/contract/ingest-envelope.spec.ts` hand-crafts a JS-shaped and a Python-shaped envelope
  (covering both the query-string and `X-Sentry-Auth`-header DSN auth forms), confirms grouping,
  confirms a retransmitted `event_id` doesn't double-count, and confirms the `429` +
  `X-Sentry-Rate-Limits` behavior at the documented request count. Not run against a real installed
  `@sentry/browser`/`sentry-sdk` package — the envelope grammar is identical either way, so this is
  the same substitution the "Contract-level alternative" note above already sanctions.
- **User Story 2 (issue detail)**: validated via `tests/contract/source-map-upload.spec.ts` (which
  exercises `GET /api/internal/issues` and `GET /api/internal/issues/:id`'s full shape as part of
  its resolution assertion) and `tests/e2e/issues-list-and-detail.spec.ts`, which drives the actual
  browser UI — issues list → click into detail (stack trace, culprit) → back — pre-authenticated.
- **User Story 3 (source map resolution)**: validated end-to-end via
  `tests/contract/source-map-upload.spec.ts`'s second test — uploads a real Source Map v3 fixture,
  ingests a minified-frame event referencing that release, and confirms the issue detail's frame
  resolves to the original file/function (`resolved: true`) without re-triggering the error. This is
  also T027's spike proof for `@jridgewell/trace-mapping` inside the real Workers runtime — see
  research.md §6.
- **User Story 4 (suspect commits)**: `worker/modules/github/app-auth.ts`'s JWT signing and
  installation-token exchange are unit-tested (`tests/unit/github-app-auth.test.ts`, GitHub's API
  mocked at the `fetch` boundary) and the connect/disconnect endpoints were manually verified against
  a running `wrangler dev` (`POST .../github/connect` → `200 {"owner","repo"}`,
  `DELETE .../github` → `200` empty body). The full live flow — a real GitHub App installed against a
  real test repository, then confirming the suspect commit shown matches that repo's actual commit
  history — was not run in this environment, per this file's own Prerequisites note that a
  registered GitHub App is "not required to validate User Stories 1–3" and is therefore the one piece
  of this quickstart that needs a real external GitHub App to complete. `lookupSuspectCommit`
  (`worker/modules/github/suspect-commit.ts`) returns `null` gracefully with no repo connected, which
  every other suite's issue-detail assertions already exercise implicitly (none of them set up a
  GitHub connection first).
