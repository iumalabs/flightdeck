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
  --command "SELECT id, dsn_public_key FROM projects WHERE id = 'demo'"
```

Configure a real `@sentry/browser` (or `@sentry/react`) instance and a real Python `sentry-sdk`
instance, each with `dsn: "http://<public_key>@127.0.0.1:8787/demo"` (local dev — no TLS), trigger a
captured exception from each, and confirm both appear in `GET /api/internal/issues` (or the Issues
screen in the browser) as separate issues with `eventCount: 1`. Trigger the JS error a second time
and confirm the existing issue's `eventCount` becomes 2, not a new issue.

Contract-level alternative (no real SDK install needed): hand-craft an envelope body matching
`contracts/ingest-api.md`'s grammar and `curl` it directly at
`http://127.0.0.1:8787/api/demo/envelope/?sentry_key=<key>&sentry_version=7`.

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
3. Upload the source map: `POST /api/internal/projects/demo/source-maps` (multipart: `release`,
   `minifiedPathPattern`, `file`).
4. Re-fetch the issue's detail and confirm the stack trace now shows original file/function/line,
   not the minified equivalent — without re-triggering the error.

## Validate User Story 4 — suspect commits

1. Complete a GitHub App installation against a real (test) repository.
2. `POST /api/internal/projects/demo/github/connect` with the resulting installation id/owner/repo.
3. Trigger an error whose culprit frame's file path exists in that repository.
4. Confirm the issue detail's `suspectCommit` field names the actual most recent commit that
   touched that file.

## Automated test commands

```sh
deno task test              # unit: envelope, fingerprint, dsn-auth, sourcemap-resolve, github-app-auth
deno run -A npm:playwright test tests/contract/   # contract tests against a real wrangler dev
deno task test:e2e           # issue-list → issue-detail UI flow
```
