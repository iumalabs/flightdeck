# Quickstart: Landing Site, Access Login & App-Shell Skeleton

## Prerequisites

- Deno 2.x installed.
- `wrangler` authenticated against the `Max Yugai` Cloudflare account (already the case in this
  environment).
- A Cloudflare Access application already exists for the target environment (production:
  `TEAM_DOMAIN=https://yugai.cloudflareaccess.com`,
  `POLICY_AUD=f79f510d9061fcd9fbf467b45ebc5bf03948636828a1639024ff127a5bcbf97d`).
- `.dev.vars` created locally from `.dev.vars.example` (see README) for `deno task dev`.

## Setup

```sh
deno install
deno task db:migrations:apply:local
```

## Run locally

```sh
deno task dev
```

Visit `http://127.0.0.1:5173` (Vite default) or whichever port `wrangler`/Vite report. The
marketing site should render with no authentication required.

## Validate User Story 1 — marketing site

1. Load the site with no session.
2. Click through Home → Product → Docs → Self-hosting → Changelog via the top nav.
3. Confirm each page renders without a full reload (watch the network tab — no document
   navigation after the first load) and none of them prompt for login.
4. Reload directly at `/docs` (or the equivalent deep-linked path) and confirm it still renders
   correctly, not just via in-app navigation.

**Expected outcome**: matches spec SC-001 — every page interactive quickly, zero auth prompts.

## Validate User Story 2 — Access login (local, pre-authenticated request)

Because the real external IdP challenge can't be driven locally (research.md §5), validate the
FlightDeck-side behavior directly:

```sh
# Simulate an authenticated request without a real Access session, using a test-signed JWT
# (unit tests under tests/unit/access-jwt.test.ts cover the actual signature/claims verification
# logic in isolation — this step is for manually poking the running dev server).
curl -s http://127.0.0.1:8787/api/internal/me \
  -H "Cf-Access-Jwt-Assertion: <test-signed-jwt>"
```

**Expected outcome**: `200` with the identity JSON on a valid token; `403` with no body detail on a
missing/invalid/expired token or wrong audience — matches spec SC-003.

For the real end-to-end redirect, deploy to the `preview` environment and click "Log in" as a user
covered by the Access policy — this is the manual verification step called out in research.md §5
and MUST be performed once before this feature is considered release-ready, even though it isn't
part of the automated suite.

## Validate User Story 3 — app shell & sign out

1. With an authenticated session (via the manual Access login above, or Playwright's
   pre-authenticated context per `tests/e2e/app-shell-empty-states.spec.ts`), click through every
   sidebar destination.
2. Confirm each renders a distinct "no data yet" empty state — none of the design mockup's sample
   issues/traces/logs should appear.
3. Open the user menu and confirm it shows the signed-in email.
4. Click sign out, confirm return to the marketing site, then attempt to reload an app-shell URL
   directly and confirm it routes back into the sign-in flow rather than showing stale content.

## Automated test commands

```sh
deno task test        # unit tests
deno task test:e2e     # Playwright (excludes the real Access IdP challenge — see research.md §5)
deno task fmt
deno task lint
deno task build
```
