# Phase 0 Research: Landing Site, Access Login & App-Shell Skeleton

## 1. Cloudflare Access JWT verification pattern

**Decision**: Reuse FlareTower's pattern exactly: `jose`'s `createRemoteJWKSet` against
`https://<TEAM_DOMAIN>/cdn-cgi/access/certs`, cached per-team-domain across warm isolate
invocations (a `Map` keyed by team domain, not a fresh `createRemoteJWKSet()` per request);
`jwtVerify(token, jwks, { issuer: TEAM_DOMAIN, audience: POLICY_AUD })`; on any failure
(missing header, bad signature, expired, issuer/audience mismatch, or a payload missing
`sub`/`email`), return `403` with no detail distinguishing the failure reason.

**Rationale**: This is a proven, already-running pattern in the sibling FlareTower project against
the same Cloudflare account, so it inherits real operational confidence rather than being a
first-time implementation. Constitution Principle II requires exactly this behavior.

**Alternatives considered**: Cloudflare's `get-identity` endpoint as the sole source of truth
(rejected — that endpoint is documented as an enrichment call, not a substitute for independent JWT
verification, and skipping local verification would violate Principle II's fail-closed requirement
outright, not just deviate from a preference).

## 2. First-login auto-provisioning

**Decision**: `upsertUser(db, { sub, email, idp })` — insert-or-update keyed on `sub`, updating
`email` and `last_seen_at` on every call (email can legitimately change at the IdP while `sub`
stays stable), setting `created_at`/role defaults only on first insert. Called synchronously inside
the auth middleware before the request is allowed to proceed, mirroring FlareTower's
`upsertOperator` call site inside `accessAuth`.

**Rationale**: Spec FR-007/FR-008 require both "auto-create on first login" and "recognize returning
users," which a single upsert satisfies without a separate provisioning step or admin action.

**Alternatives considered**: A separate one-time "claim your account" step after first Access login
(rejected — spec explicitly requires *no* separate manual provisioning step, FR-007).

## 3. Sign-out semantics against Cloudflare Access

**Decision**: FlightDeck's sign-out clears only FlightDeck's own client-side session recognition
(the SPA's in-memory/local session state derived from `GET /api/internal/me`) and navigates back to
the marketing site. It does not attempt to revoke the underlying Cloudflare Access session/cookie —
Access owns that session lifecycle (its own `session_duration`, currently 24h per the existing
Access application config) independently of the application behind it, and Access does not expose an
application-triggerable "log this session out" API for a self-hosted application to call on the
user's behalf.

**Rationale**: This matches how Access-fronted applications actually behave in practice (confirmed
against the existing FlareTower/Access application configuration) and matches spec Assumptions,
which explicitly scope sign-out to FlightDeck's own recognition, not the IdP session. A user who
truly wants to end their Access session altogether uses Cloudflare's own sign-out mechanism
(`/cdn-cgi/access/logout` on the team domain), which is out of scope to build UI around in this
module but does not need to be — FlightDeck's own sign-out already satisfies spec FR-012 ("their
next visit to an authenticated area requires signing in again"): even with a live Access cookie, the
sign-in modal's "Continue with Cloudflare Access" click re-enters the Access flow, and Access will
silently re-approve without a fresh challenge only because the *user's* Access session is still
valid — which is correct, expected behavior, not a bug in FlightDeck's own sign-out.

**Alternatives considered**: Linking to `/cdn-cgi/access/logout` from FlightDeck's sign-out action
(deferred, not rejected — worth adding as a later, low-effort enhancement once the base flow is
proven; not required to satisfy this module's acceptance scenarios, so left out to keep scope tight).

## 4. Client-side routing approach

**Decision**: A small hand-rolled router: a single `screen` (marketing) / `shellScreen` (app-shell)
piece of state in `App.tsx`, driven by `history.pushState`/`popstate` for real URLs (so deep links
and back/forward work per spec's Edge Cases), with a lookup table mapping pathname → screen
component. No routing library dependency.

**Rationale**: ~16 total screens with no nested/dynamic route params in this module (no `/issues/:id`
yet — that's Module 2) doesn't justify a router library's bundle weight or API surface. The design
source itself uses exactly this state-driven pattern (`sc-if`/`state.page`/`state.screen`), so this
also keeps the implementation's mental model aligned with the approved design rather than translating
it through an unrelated abstraction.

**Alternatives considered**: `react-router` (rejected for now — reconsider once Module 2 introduces
real per-entity routes like an issue detail page with meaningful nested/param routing needs).

## 5. Testing the real Access login redirect

**Decision**: Automated coverage stops at "clicking the button initiates a real navigation to the
Access authorization endpoint" (assertable via the constructed redirect URL/host, without following
it) and resumes at "a request carrying a valid, verifiable JWT reaches the app shell" (using a
test-signed JWT against a test JWKS in unit tests, and a pre-authenticated browser context — a
cookie/header injected directly — in Playwright, rather than driving a real external IdP). The
actual external IdP challenge (whatever provider sits behind the team's Access policy) is verified
manually against the deployed preview/production environment as part of this feature's release
checklist, not in CI.

**Rationale**: Spec FR-004/FR-005 and SC-002/SC-003 are about FlightDeck's own behavior at the
boundary of that redirect (initiating it correctly, and correctly gating on its result) — the IdP's
own challenge UI is Cloudflare's and the IdP's responsibility, not something this codebase can or
should simulate in an automated suite. This mirrors how FlareTower's own constitution frames
Playwright coverage requirements without claiming to automate the IdP itself.

**Alternatives considered**: Mocking the entire Access flow end-to-end inside Playwright with a fake
IdP (rejected as scope-inappropriate for this module — it would test a fake IdP's behavior, not
FlightDeck's, and risks false confidence about the real integration).

## 6. Font delivery

**Decision**: Self-host `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` as npm
dependencies (via Deno's `npm:` specifier), matching FlareTower, rather than loading from Google
Fonts at runtime as the original design mockup's `<link>` tags do.

**Rationale**: Removes a third-party network dependency from every page load and matches the
sibling project's already-validated approach. Space Grotesk (used for display type in the design)
is also available via Fontsource and should be added alongside the two FlareTower already uses.

**Alternatives considered**: Keeping the design's Google Fonts `<link>` tags as-is (rejected —
introduces an external runtime dependency and a render-blocking font fetch FlareTower's approach
already avoids).

## 7. Seed project for the app-shell project switcher

**Decision**: The baseline migration inserts exactly one demo `projects` row (e.g. `name: "Demo
Project"`) so the shell's project switcher and Overview screen have something concrete to render.
No DSN/public-key column is populated meaningfully yet (Module 2 introduces real DSN issuance) — a
placeholder value is acceptable since nothing reads it as a real credential in this module.

**Rationale**: Spec's Key Entities section explicitly scopes this to "at least one such record...
issuing real projects/DSNs is out of scope here." Seeding via migration (not a runtime
first-request check) keeps the app shell deterministic in every environment, including fresh local
dev.

**Alternatives considered**: Auto-creating a project on first user login instead of a static seed
row (rejected — adds stateful logic to the login path for a value this module doesn't need to be
dynamic, and risks producing a different number of demo projects across environments/test runs).
