# Quickstart: Releases

## Prerequisites

- Module 2 (Error monitoring) running locally, migration applied — this module extends its
  `releases`/`issues` tables and GitHub App infrastructure directly.
- This module's migration applied locally: `deno task db:migrations:apply:local` (re-run after
  `0005_releases.sql` is added).
- A real `sentry-cli` installation (`curl -sL https://sentry.io/get-cli/ | bash`, or the `@sentry/cli`
  npm package run via `npx` — either is fine for this manual validation step; research.md §8 —
  automated tests do NOT depend on this).

## Validate User Story 1 — sentry-cli release flow

```sh
curl -X POST http://127.0.0.1:8787/api/internal/projects/demo/api-tokens \
  -H "Cookie: fd_session=<local test session>"
# save the returned "token" value — shown once
```

```sh
export SENTRY_URL=http://127.0.0.1:8787/
export SENTRY_AUTH_TOKEN=<token from above>
export SENTRY_ORG=flightdeck   # any value — accepted, not validated (research.md §3)
export SENTRY_PROJECT=demo

sentry-cli releases new 1.0.0-quickstart
sentry-cli releases files 1.0.0-quickstart upload-sourcemaps ./dist --url-prefix '~/'
sentry-cli releases finalize 1.0.0-quickstart
```

Confirm the release appears in `GET /api/internal/releases`, and that a subsequently-ingested
error whose stack trace references that release's minified files resolves against the uploaded
source maps (Module 2's existing resolution behavior).

## Validate User Story 2 — release health

Hand-craft `"session"`/`"sessions"` envelope items (per contracts/release-management-api.md's
grammar reference and research.md §5's field shapes) with a known distribution of crashed/ok
sessions tagged to the release created above, and `curl` them at the envelope endpoint. Confirm
`GET /api/internal/releases/{id}` reflects the correct adoption/crash-free figures for that known
distribution, broken down per environment.

## Validate User Story 3 — regression detection

1. Trigger an error, confirm an issue is created (Module 2's existing flow).
2. Resolve it: `curl -X POST .../api/internal/issues/{id}/resolve -d '{"mode":"exact","releaseId":"<release from US1>"}'`.
3. Create a NEW, later release (`sentry-cli releases new 1.0.1-quickstart`).
4. Trigger the SAME underlying error again, tagged with the new release.
5. Confirm the issue's `status` is back to `unresolved` and it appears in the default active-issues
   view again.
6. Trigger the same error tagged with the ORIGINAL (or an earlier) release — confirm it does NOT
   reopen (spec.md's Edge Cases).

## Validate User Story 4 — commits and deploys

```sh
sentry-cli releases set-commits 1.0.0-quickstart --auto
sentry-cli releases deploys 1.0.0-quickstart new -e production
sentry-cli releases list
sentry-cli releases delete 1.0.0-quickstart
```

Confirm each reflects correctly in `GET /api/internal/releases/{id}` (commits/deploys) before the
final `delete`, and that `list`/`delete` operate against the same data a dashboard view is backed
by.

## Automated test commands

```sh
deno task test              # unit: release-health, regression, api-token
deno task test:contract     # contract tests against a real wrangler dev (hand-crafted requests)
deno task test:e2e           # releases list -> detail, issue-resolve action
```
