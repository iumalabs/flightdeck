# FlightDeck

[![CI](https://github.com/iumalabs/flightdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/iumalabs/flightdeck/actions/workflows/ci.yml)
[![E2E](https://github.com/iumalabs/flightdeck/actions/workflows/e2e.yml/badge.svg)](https://github.com/iumalabs/flightdeck/actions/workflows/e2e.yml)
[![License: AGPL v3](https://img.shields.io/github/license/iumalabs/flightdeck)](LICENSE)
[![Open issues](https://img.shields.io/github/issues/iumalabs/flightdeck)](https://github.com/iumalabs/flightdeck/issues)
[![Last commit](https://img.shields.io/github/last-commit/iumalabs/flightdeck)](https://github.com/iumalabs/flightdeck/commits/main)

A Sentry-protocol-compatible observability platform — errors, distributed tracing, structured logs,
releases, uptime monitoring and user feedback, unified by shared identifiers so an alert, a log
line, and a stack frame are always one click apart. Point an existing Sentry SDK at a new DSN and it
keeps working unmodified.

FlightDeck runs as a single Cloudflare Worker, self-hostable or hosted. Its dashboard sits behind
Cloudflare Access — see [Authentication](#authentication) below.

Read [`.specify/memory/constitution.md`](.specify/memory/constitution.md) first; it is the
authoritative source for the project's principles, architecture, and security requirements. This
README covers day-to-day setup and operation only.

## Status

Module 1 (**Landing site, Access login, and app-shell skeleton**) is implemented — see
[`specs/001-landing-access-login/`](specs/001-landing-access-login/) for its spec, plan, and tasks.
This is the first module in the constitution's product scope (§2); no ingest endpoint, real
telemetry data, or DSN issuance exists yet. Not yet deployed — see [Deployment](#deployment) for
the one-time Cloudflare-dashboard step that has to happen before `release` builds go live.

## Authentication

FlightDeck implements no identity provider of its own. Cloudflare Access fronts a single bounce
path, `/login` — the SPA serves both the public marketing site and the authenticated app shell from
one origin, so Access cannot gate "the app-shell part" directly without a distinct Access-scoped
path. `/login` verifies the `Cf-Access-Jwt-Assertion` header Access injects there, then mints
FlightDeck's own signed `fd_session` cookie, which is what every other control-plane request
(`/api/internal/*`) is verified against. Both steps fail closed on any verification error
(constitution Principle II). Future ingest endpoints (`/api/{project_id}/envelope/` etc.) will be
public by design, authenticated by each project's DSN key instead — see the constitution for the
full trust-surface split.

**Required manual post-deploy step**: Preview URLs default to public. Restrict them via **Workers &
Pages → flightdeck → Settings → Domains & Routes → Preview URLs → Enable Cloudflare Access** (a
single, account-wide, reusable "Cloudflare Workers Preview URLs" Access policy covers this for every
Worker in the account, including FlareTower's — it does not need to be recreated per Worker).

## Environment

| Variable         | Example                              | Notes                                                                                                                                                                                                     |
| ---------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEAM_DOMAIN`    | `https://yugai.cloudflareaccess.com` | Cloudflare Access team domain; enables JWT verification. Non-secret.                                                                                                                                      |
| `POLICY_AUD`     | _(Access application AUD tag)_       | Expected audience claim of `Cf-Access-Jwt-Assertion`. Non-secret.                                                                                                                                         |
| `CF_ACCOUNT_ID`  | `8b655d0dde6d223b9ce11116a014973a`   | Cloudflare account id. Non-secret.                                                                                                                                                                        |
| `SESSION_SECRET` | _(random string)_                    | **Secret** — HMAC key `/login` signs the `fd_session` cookie with. Set via `wrangler versions secret put SESSION_SECRET` (no `--env` flag — see the comment in `wrangler.jsonc`), never as a plain `var`. |

Copy `.dev.vars.example` to `.dev.vars` (gitignored) for local `deno task dev`.

**Known dev-mode quirk**: `deno task dev` (plain Vite, for HMR) does not apply SPA fallback on a
hard reload of a nested path (e.g. reloading directly at `/docs` 404s) — this is a Vite
dev-server-only limitation; the built output served through `wrangler dev` or a real deploy handles
it correctly. Navigate via in-app links during `deno task dev`, or use
`deno task build && deno run -A npm:wrangler dev --env preview` (what the e2e suite itself runs) to
test deep links locally.

## Local development

```sh
deno install
deno task db:migrations:apply:local
deno task dev
```

```sh
deno task test        # unit tests
deno task test:e2e     # Playwright e2e (excludes the real Cloudflare Access IdP challenge)
deno task fmt
deno task lint
deno task build
```

See [`specs/001-landing-access-login/quickstart.md`](specs/001-landing-access-login/quickstart.md)
for scenario-by-scenario validation steps.

## Deployment

Deployment uses the native Cloudflare → GitHub integration (Workers Builds), not a deploy step in
GitHub Actions — GitHub Actions runs `fmt`/`lint`/`typecheck`/unit-test/build as PR gates only. The
production branch is `release`, which `release-please` fast-forwards on every release (see
`.github/workflows/release-please.yml`).

**Required one-time setup** (cannot be scripted): in the Cloudflare dashboard, connect
`iumalabs/flightdeck` under **Workers & Pages → Create → Import a repository**, and set the
production branch to `release`, not `main`.

`workers_dev` is `false` from the first commit and MUST stay that way (constitution Principle I).

## Releases

Versioning follows `release-please` against the root `VERSION` file (`"simple"` release type).
Release-please branch names stay short (`release`, not a per-component prefixed name) to match the
Workers Builds production-branch configuration above.

## License

[AGPL-3.0](LICENSE).
