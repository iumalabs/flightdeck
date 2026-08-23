<!--
Sync Impact Report
==================
Version change: 1.1.1 → 1.2.0
Modified principles: n/a (no Core Principle changed)
Modified sections: Product Scope & Module Roadmap — added item 8, "Multi-project
  support", documenting a real, already-implemented post-hoc module
  (specs/008-multi-project-support/) discovered mid-session: every
  dashboard-facing internal route had been hardcoded to a single seeded "demo"
  project (or, for issues, had no project filter at all), which only became a
  real gap once a second real application needed onboarding. This is a MINOR
  bump (new roadmap item / materially expanded guidance), not a Core Principle
  change — the module's own design (a project-creation endpoint plus a shared
  ?project= resolution helper reused by every pillar module) is directly
  governed by, and fully consistent with, Principle V's shared-module rule and
  Principle X's admin-mutation audit-log rule; nothing here contradicts an
  existing principle.
Added sections: Product Scope & Module Roadmap, item 8 (Multi-project support)
Removed sections: n/a
Templates requiring alignment: none — this change touches roadmap prose only,
  no principle or gate structure changed.
Follow-up TODOs: none.
-->

# FlightDeck Constitution

## Core Principles

### I. Two Trust Surfaces: Access-Gated Control Plane, DSN-Authenticated Ingest

FlightDeck exposes exactly two categories of route, and every route MUST fall cleanly into one of
them — a route serving both purposes is a constitution violation:

- **Control plane**: the SPA, and any `/api/internal/*` route (project and member management,
  dashboard reads/writes). Sits behind Cloudflare Access on the production custom domain.
- **Ingest**: the Sentry-protocol endpoints (`/api/{project_id}/envelope/`, `/store/`, `/minidump/`,
  and equivalents). MUST be publicly reachable on the production custom domain with no Cloudflare
  Access gate — an SDK running in a customer's production environment cannot complete an interactive
  login. Ingest authenticates via the DSN's embedded public key (Principle III), never via Access.
  `workers_dev: false` MUST hold from the first commit, exactly as it would for an Access-only
  product — this principle is about which routes require _Access_, not about tolerating the bare
  `*.workers.dev` URL. Preview URLs follow the same manual post-deploy restriction FlareTower
  documents. **Rationale**: Conflating these two surfaces is the single most likely way to either
  lock legitimate SDK traffic out (ingest behind Access) or leave the dashboard open to the internet
  (control plane routes missing Access) — naming both explicitly, with a hard rule about which
  routes belong where, removes the ambiguity that causes either mistake.

### II. Defense-in-Depth JWT Validation, Fail Closed (Control Plane)

Cloudflare Access, on this project, is scoped to a single bounce path (`/login`) rather than the
whole control-plane surface — the SPA is one client-routed bundle serving both the public marketing
site and the authenticated app shell from the same origin, so Access cannot cleanly gate "the
app-shell part" at the edge without a distinct, Access-scoped path. Authentication therefore has two
verification steps, both mandatory and both fail-closed:

1. **At `/login`** (the only path actually covered by the Access application): extract the
   `Cf-Access-Jwt-Assertion` header Access injects for this path, validate its signature against the
   team JWKS at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, and verify `issuer`
   (team domain) and `audience` (this application's Access AUD tag) claims. On any missing header,
   invalid signature, expired token, or issuer/audience mismatch, the Worker MUST return `403` and
   MUST NOT mint a session. There is no degraded-but-permitted mode.
2. **On every other control-plane request** (`/api/internal/*`, and the initial load path that
   decides SPA vs marketing rendering): `/login`, once it has verified step 1, MUST mint
   FlightDeck's own signed, `HttpOnly`, `Secure` session token (a compact JWT signed with a Worker
   secret FlightDeck controls) and set it as a cookie — this token, not `Cf-Access-Jwt-Assertion`,
   is what every subsequent control-plane request is verified against, since Access does not inject
   its header outside the path it actually protects. The same fail-closed rule applies: a missing,
   invalid, expired, or tampered FlightDeck session token MUST return `403` with no degraded mode,
   exactly as step 1 requires for the Access JWT itself. The verified identity's `sub` and `email`
   (captured from the Access JWT at step 1, carried forward into FlightDeck's own session token) are
   the only identity FlightDeck trusts for a control-plane request. This principle applies only to
   the control-plane surface defined in Principle I — it MUST NOT be applied to ingest routes, which
   would break every SDK integration. **Rationale**: A misconfigured Access policy is a realistic
   failure mode. Independent verification inside the Worker — of the Access JWT at the one path
   Access actually reaches, and of FlightDeck's own session token everywhere else — is the last line
   of defense protecting customer telemetry and account data, and "fail closed" is the only
   acceptable posture for that line.

### III. DSN-Key Authentication for Ingest, Fail Closed

Every ingest request MUST be authenticated by the DSN's embedded public key, extracted from the
`X-Sentry-Auth` header (`sentry_key=...`) or, where the Sentry protocol allows it, the DSN embedded
in the request URL/query string. The key MUST resolve to an active project; on a missing, malformed,
unknown, or explicitly revoked key, the Worker MUST reject the request (`401` or `403`) and MUST NOT
persist or forward the payload. A revoked or rate-limited key is a fail-closed condition, not a
fail-open one — silently accepting and dropping the event is not an acceptable substitute for
rejecting it. Per-project ingest MUST be rate-limited so one noisy or compromised DSN cannot exhaust
shared ingest capacity for other projects. **Rationale**: The DSN key is the only authentication
ingest can rely on — it is embedded in client-side and server-side code the operator does not fully
control. Treating it with the same fail-closed rigor as Access JWTs (Principle II) is what keeps
ingest from becoming an open write endpoint.

### IV. Sentry Protocol Compatibility Is a Hard External Contract

FlightDeck's ingest and release-management surface MUST track the real Sentry API closely enough
that an existing, unmodified Sentry SDK works after only its DSN changes:

- Envelope, store, and minidump endpoint paths, methods, and payload shapes MUST match Sentry's
  documented protocol for the SDK versions FlightDeck claims to support.
- The DSN format (`https://{public_key}@{host}/{project_id}`) MUST parse and construct identically
  to Sentry's own.
- Release and source-map management MUST be reachable through a CLI whose command surface is
  compatible with `sentry-cli` (constitution-level requirement; the CLI itself ships when Module 5 —
  Releases — is built). A protocol deviation is never a silent judgment call: it MUST be documented
  in the relevant spec's research notes, with the specific SDK behavior it protects or breaks named
  explicitly. **Rationale**: "Point an existing Sentry SDK at a new DSN" is FlightDeck's core value
  proposition (see the founding design). A subtle protocol mismatch doesn't fail loudly in code
  review — it fails silently in a customer's production error reporting, which is the worst place
  for it to surface.

### V. Single Worker, One Module Per Pillar

FlightDeck runs as one Cloudflare Worker with a `fetch` handler that serves the React SPA (via the
Workers static-assets binding) and the JSON API (both control-plane and ingest routes, per Principle
I). Product logic is organized one directory per pillar (error monitoring, tracing, logs, releases,
uptime, feedback), mirroring FlareTower's per-module layout. Shared mechanics used by more than one
pillar — envelope parsing, DSN resolution, D1 access helpers — MUST live in one shared module, not
be copy-pasted per pillar. A future scheduled handler (uptime checks, Module 6) MUST reuse the same
evaluation logic the interactive path would use for the same check, exactly as FlareTower's audit
logic is never duplicated between its interactive and scheduled paths. **Rationale**: Six pillars
sharing one ingest pipeline and one identity model is the whole point of the product ("every event
carries the same identifiers", per the founding design) — per-pillar module boundaries keep that
shared spine from fragmenting into six divergent implementations.

### VI. Deno-Only Local Toolchain

All local development tooling MUST run through Deno: `deno fmt`, `deno lint`, `deno test`,
`deno coverage`, `deno task`. The repository MUST NOT contain a `package.json`, and `node_modules`
MUST NOT be committed. npm is not an accepted package manager under any circumstance. npm _packages_
are permitted, but only via Deno's `npm:` specifier, declared through the import map in `deno.json`.
A tool that would otherwise force a `package.json` MUST first be proven to run acceptably via `npm:`
specifiers under Deno; if it cannot, the friction MUST be documented and options proposed before the
tool is adopted. **Rationale**: A single, consistent toolchain keeps contributor setup trivial and
avoids the dependency-resolution divergence of running two package managers side by side.

### VII. One Configuration File

Everything Deno is capable of holding — import map, task definitions, formatter settings, linter
rules, TypeScript compiler options — MUST live in a single `deno.json`. Separate `tsconfig.json`,
`.eslintrc`, `.prettierrc`, or equivalent files MUST NOT be created. **Rationale**: Minimizing
configuration surface makes the project easier to reason about for both humans and coding agents
working across sessions.

### VIII. Strict TypeScript, Test-First, Playwright for User-Facing Flows

All code is TypeScript in strict mode; `any` and implicit-any escapes require explicit justification
in review. Every feature MUST ship with tests before it is considered done. Every user-facing flow
(the login redirect through Access, the SDK-facing ingest contract, any dashboard flow a customer
relies on) MUST have Playwright end-to-end coverage where it is browser-driven; ingest-protocol
behavior that is not browser-driven MUST instead have contract-level unit/integration tests
exercising the real request/response shape. Shared pipeline logic (Principle V) MUST be tested once
at the shared layer, not re-verified separately per pillar. **Rationale**: FlightDeck is the
error-reporting and observability system customers reach for when something else has already gone
wrong — an untested code path here degrades the tool at the exact moment it needs to be trustworthy.

### IX. Customer Telemetry Confidentiality by Default

Ingested telemetry (stack traces, breadcrumbs, request/user context) MAY contain customer PII.
Worker `console.log`/`console.error` output MUST NOT include ingested event payloads or DSN keys —
logging is for FlightDeck's own operational behavior, not a mirror of customer data. Secrets
(Cloudflare API tokens, signing keys, IdP-related values) MUST be stored only as Worker secrets
(`wrangler secret put` / `wrangler versions secret put`), never as plain `vars` in `wrangler.jsonc`,
never committed, and never accepted through the web UI. D1 access from application code MUST go
through the shared data-access module (Principle V) rather than ad hoc queries scattered per route,
so retention and access rules stay enforceable in one place. Event/log/trace retention windows are
product-configurable but MUST default to a bounded, documented period — unbounded-by-default
retention of customer telemetry is not acceptable. **Rationale**: Unlike FlareTower, FlightDeck's
highest-value asset is not a cloud-account credential — it's the customer telemetry itself, which is
often sensitive by nature (it exists specifically to capture what went wrong, including the data
present at the time). Confidentiality of that data, and of the ingest key that gates access to it,
is the load-bearing security property here.

### X. Admin Mutations Are Recorded

Every control-plane mutation that changes account-level state — project creation, DSN
rotation/revocation, member invitation or role change, alert rule changes — MUST be written to an
`audit_log` table (actor `sub`, action, before/after values, timestamp) as part of that action's own
transaction, before the action is considered complete. This applies to FlightDeck's own admin
surface only; it does NOT apply to ingest (Principle III already governs ingest's fail-closed
behavior, and per-event audit rows for telemetry ingest would be prohibitively expensive at ingest
volume — the audit log is for who-changed-what-configuration, not a duplicate of the event store).
**Rationale**: A team sharing one FlightDeck project needs to know who rotated a DSN or removed a
member; scoping this to admin actions (rather than FlareTower's every-Cloudflare-mutation scope)
keeps the guarantee proportionate to FlightDeck's actual mutation surface.

### XI. English-Only, Conventional Commits

All code, comments, in-app copy, documentation, and commit messages MUST be in English. Commit
messages MUST follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.). **Rationale**:
FlightDeck is AGPL-3.0 open-source, self-hostable, and intended for a non-Russian-speaking
contributor community from day one; consistent language and commit conventions keep the project
approachable to outside contributors.

## Product Scope & Module Roadmap

FlightDeck is a Sentry-protocol-compatible observability platform: errors, distributed tracing,
structured logs, releases, uptime monitoring, and user feedback, unified by shared identifiers
(trace, release, user, environment) so an alert, a log line, and a stack frame are always one click
apart. It ships both hosted and self-hosted, per the founding design (marketing site copy:
"Self-host on your own infra, or run it on Cloudflare").

Full intended module surface, in build order (implementation is incremental; each module beyond the
first gets its own spec on its own branch when its turn comes — this list is the durable target, not
a commitment to build all of it now):

1. **Landing, Access login, and app-shell skeleton** — the public marketing site
   (Product/Docs/Self-hosting/Changelog), the Cloudflare Access login flow (Principle II), and the
   authenticated app shell (sidebar navigation across the six pillars below, empty states, no real
   telemetry data yet). This is the first module to be specified and built.
2. **Error monitoring** — issue grouping/fingerprinting, stack traces, source map resolution,
   breadcrumbs, suspect commits.
3. **Distributed tracing** — span waterfalls, p50/p95 per transaction, latency budgets.
4. **Structured logs** — live tail, search, retention, S3-compatible export.
5. **Releases** — adoption, crash-free sessions, regression detection, sentry-cli-compatible
   release/source-map upload (Principle IV).
6. **Uptime monitoring** — single-region HTTP/TCP checks (multi-region deferred — Cloudflare Cron
   Triggers have no controllable execution region; see specs/006-uptime-monitoring/research.md),
   incident-aware alerting, the first scheduled-handler consumer of Principle V's shared
   evaluation-logic rule.
7. **User feedback** — drop-in widget, crash-report dialog, linkage to the originating event.
8. **Multi-project support** — a post-hoc addition, not part of the original seven-module roadmap:
   every dashboard-facing internal route had been hardcoded to a single seeded "demo" project (or,
   for issues, had no project filter at all), which only became a real gap once a second real
   application needed onboarding. Adds a project-creation endpoint (a real, working, isolated DSN
   per project) and dashboard-wide `?project=` scoping/switching, resolved through one shared helper
   reused by every pillar module (Principle V) — see specs/008-multi-project-support/.

## Identity & Authorization Data Model

D1 is the datastore from the start. A `users` table is required from the first commit, designed
around:

- `sub` from the Access JWT as the primary stable key — the email column MUST NOT be used as a key,
  since emails change.
- `email`, `idp` (which provider authenticated the user), `created_at`, `last_seen_at`.
- Application-level roles independent of Cloudflare Access group membership, though they MAY be
  synced from Access groups. FlightDeck roles are the authority for in-app permissions.

An `audit_log` table is required from the first commit, recording every admin mutation per Principle
X: actor (`sub`), action, timestamp, and before/after values.

A `projects` table (DSN issuance target) and its DSN public-key column are introduced no later than
Module 2 (the first module that actually ingests events), not deferred further — Module 1 MAY seed a
placeholder/demo project row for the app-shell skeleton but MUST NOT invent a parallel identity
model that Module 2 would then have to reconcile.

## Design System

The visual layer is sourced from the Claude Design project at
`https://claude.ai/design/p/049eb4bb-2824-4bc1-bca5-c76c775e7f36` (`FlightDeck.dc.html` — marketing
site and login; `FlightDeckApp.dc.html` — the six-pillar authenticated dashboard mockup). It MUST be
read (via the `claude_design` MCP, or by asking the project owner for exported screens) before any
UI decision is made, and treated as the source of truth for the visual layer, exactly as FlareTower
treats its `docs/design.zip`:

- Color and typography tokens (dark theme: `--bg:#0B0B0C`, `--accent:#B8F135` lime, Space Grotesk
  for display type, IBM Plex Sans for body, IBM Plex Mono for code/metadata; a parallel light theme
  exists in `FlightDeckApp.dc.html`) are extracted into CSS custom properties in one place; hex
  values MUST NOT be hardcoded across components.
- Component patterns from the two `.dc.html` files are followed rather than invented fresh: the
  marketing nav/hero/feature-grid/docs/changelog layouts from `FlightDeck.dc.html`, and the
  sidebar/topbar app-shell structure (Monitor: Overview/Issues/Traces/Logs; Ship: Releases/Uptime;
  Respond: Feedback/Alerts; plus Settings and an Install-SDK flow) from `FlightDeckApp.dc.html`.
- A screen not covered by either source MAY be designed in the same visual language, with that fact
  noted explicitly in the PR description.
- The two `.dc.html` files are a live, editable design source (not a frozen local package) —
  re-check them for updates before starting a new module's UI work, since the design project may
  have moved on since the last module was built.

## Deployment & Operations

Deployment uses the native Cloudflare → GitHub integration (Workers Builds), watching a `release`
branch that release-please fast-forwards on every release — the same pattern FlareTower uses. GitHub
Actions runs `fmt`/`lint`/`typecheck`/unit-test/build as PR gates on every pull request and push to
`main`, and a separately scheduled Playwright e2e suite; both run on the project's self-hosted
`[self-hosted, general]` runners, falling back to `ubuntu-latest` for pull requests originating from
forks (this is a public repository with an unrestricted `pull_request` trigger, so a fork PR's code
MUST NOT run on a self-hosted runner). Release-please branch names MUST stay short (`release`, not a
per-component prefixed name) to match Cloudflare Workers Builds' production-branch configuration.
`workers_dev:
false` and the Preview-URL Access-restriction requirement (Principle I) apply from the
first deploy onward.

## Governance

This constitution supersedes all other project practices and prior undocumented conventions. Every
PR MUST be evaluated against the Core Principles above before merge; a PR that violates a principle
MUST either be changed to comply or MUST document, in its description, an explicit and reasoned
exception approved by a maintainer — silent violation is not acceptable.

**Amendment procedure**: amendments are proposed as a PR modifying this file, including a completed
Sync Impact Report (as an HTML comment at the top of the file) describing what changed and why.
Amendments require maintainer approval before merge, same as any other governance-affecting change.

**Versioning policy**: this constitution is versioned independently of the codebase, using semantic
versioning:

- **MAJOR** — backward-incompatible governance changes: a principle is removed or redefined in a way
  that contradicts its prior meaning.
- **MINOR** — a new principle or section is added, or existing guidance is materially expanded.
- **PATCH** — clarifications, wording fixes, and non-semantic refinements.

**Compliance review**: any spec, plan, or task produced by the Spec Kit workflow MUST be checked
against this constitution before implementation begins. Deviations discovered during implementation
MUST be raised for resolution (either fixing the implementation or amending the constitution) before
merge, not silently absorbed.

**Version**: 1.2.0 | **Ratified**: 2026-08-21 | **Last Amended**: 2026-08-23
