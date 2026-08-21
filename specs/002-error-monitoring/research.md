# Phase 0 Research: Error Monitoring

## 1. DSN format and ingest authentication

**Decision**: DSN is `https://{public_key}@{host}/{project_id}` — public-key-only; the legacy
secret-key variant is not supported as a requirement (deprecated even in real Sentry). The ingest
endpoint (`POST /api/{project_id}/envelope/`) accepts the DSN key via **both** mechanisms real SDKs
actually use: the `X-Sentry-Auth` header (`Sentry sentry_version=7, sentry_client=..., sentry_key=
...`) and the `?sentry_key=`/`?sentry_version=` query string. Confirmed via Sentry's own developer
docs: `@sentry/browser` authenticates via query string, `sentry-sdk` (Python) via the header — since
this module targets both, supporting only one breaks one of the two target SDKs outright.

**Rationale**: This is a hard protocol-compatibility requirement (constitution Principle IV), not a
design preference — an SDK we claim to support must work unmodified.

**Alternatives considered**: Header-only (rejected — breaks `@sentry/browser`, our primary target
per the spec's own priority ordering, User Story 1 leads with the browser SDK). Query-only (rejected
— breaks `sentry-sdk`).

## 2. Envelope parsing scope

**Decision**: Parse the envelope grammar (newline-delimited envelope header JSON, then repeating
`(item header JSON, item payload)` pairs). Only the `event` item type is processed (stored,
fingerprinted, etc.) this module. Any other item type present in a well-formed envelope (`session`,
`transaction`, `attachment`, `client_report`, etc.) is **parsed enough to skip correctly (using the
item header's `length`) and otherwise silently ignored** — never rejected, and never causes the rest
of the envelope to be rejected.

**Rationale**: Modern Sentry SDKs routinely bundle multiple item types in a single envelope as part
of their normal behavior (e.g. automatic session tracking alongside an error event) — this is not
something an integrator opts out of. Rejecting the whole envelope because it contains an item type
we don't yet handle would silently break event ingestion for a completely standard, unmodified SDK,
which directly violates FR-001. Accept-and-skip is the only option consistent with "an unmodified
SDK works."

**Alternatives considered**: Reject envelopes containing unrecognized item types (rejected — breaks
FR-001 as explained above). Reject only the unrecognized item but 200 the rest (equivalent in
effect to accept-and-skip, adopted as the actual mechanism — no meaningful difference, stated for
clarity).

## 3. Ingest routing: keeping the public DSN surface separate from sessionAuth

**Decision**: Mount ingest under its own Hono sub-router matched on a project-id path parameter,
registered as a sibling to (not nested inside) `/api/internal/*`'s sessionAuth-gated router — e.g.
`app.route("/api/:projectId/envelope", ingestRoutes)` alongside the existing
`app.route("/api/internal", identityRoutes)`. Hono's router resolves a literal path segment
("internal") ahead of a dynamic param segment (":projectId") at the same position, so a request to
`/api/internal/me` is never captured by the ingest route even though ":projectId" could
theoretically match the literal string "internal". To remove any doubt rather than rely on router
internals alone, `internal` is treated as a **reserved project id** — the ingest handler explicitly
rejects it before doing a DSN lookup, and a unit test asserts `/api/internal/envelope/` never
reaches ingest logic. `worker/index.ts`'s top-level `fetch()` dispatch (currently: anything under
`/api/*` goes to the Hono `app`) does not need to change — the split happens inside the Hono app's
own routing, not at the outer dispatch layer.

**Rationale**: Module 1's `worker/index.ts` implicitly treated all of `/api/*` as "internal,
session-gated" because that was the only kind of `/api/*` route that existed. This module introduces
the first `/api/*` route that must NOT be session-gated (constitution Principle I) — the split must
be explicit and tested, not an accident of which router happened to be registered first.

**Alternatives considered**: A different top-level prefix for ingest (e.g. `/ingest/{project_id}/
envelope/`) instead of `/api/{project_id}/envelope/` (rejected — the real Sentry DSN format bakes
`/api/{project_id}/...` into the path SDKs construct from the DSN; using a different prefix would
require every SDK to be reconfigured beyond just the DSN, defeating the point).

## 4. Rate limiting

**Decision**: A Durable Object class, one instance per DSN public key (`idFromName(dsnKey)`), not a
single global instance. On limit exceeded: `429` with
`X-Sentry-Rate-Limits: {retry_after}:{categories}:{scope}` (empty `categories` = applies to all
categories), matching the exact header real SDKs already know how to parse and back off from.

**Rationale**: Cloudflare's own documentation warns against a single global Durable Object as a
throughput bottleneck. Sharding per-DSN avoids that anti-pattern entirely because it's already a
natural per-key boundary (one project's traffic never needs to coordinate with another's), not a
manufactured shard key. KV was rejected for this: it has a hard 1-write/sec-per-key limit, unworkable
for a real ingest hot path. A D1-backed counter was rejected: D1 access on every single ingest
request for a hot-path check is architecturally slower than an in-memory Durable Object counter, and
adds load to the same database the rest of ingest already writes to.

**Alternatives considered**: Cloudflare's paid Rate Limiting Rules product (rejected — external
paid dependency for something a per-DSN Durable Object solves natively). Global DO (rejected, see
above — documented anti-pattern).

## 5. Fingerprinting order and source-map interaction

**Decision**: `worker/modules/ingest/fingerprint.ts` — pure functions, no bindings, so fully
unit-testable. Order: explicit client-supplied `fingerprint` field wins outright; otherwise, if a
stack trace is present, compute from exception type + normalized frame signatures (function/module/
filename of in-app frames); otherwise fall back to the exception/message text. **Critically**,
fingerprinting runs against the source-map-resolved stack trace when a usable source map exists for
the event's release (confirmed via Sentry's own developer docs: their pipeline resolves symbolication
before grouping) — the ingest pipeline's order is therefore: parse event → attempt source map
resolution (User Story 3) → compute fingerprint (this section) → upsert issue. Getting this order
wrong (fingerprinting the raw minified trace) would fingerprint the same logical bug differently
across minified builds, which spec.md's User Story 3 Acceptance Scenario 2 explicitly tests against.

**Rationale**: Directly required by spec.md FR-003's design note and User Story 3 AC2 — this isn't a
style choice, it's what makes cross-build grouping correct at all.

**Alternatives considered**: Fingerprint before symbolication, re-fingerprint after (rejected —
would require issue re-merging logic this module doesn't otherwise need, pure added complexity for
no benefit over just ordering the pipeline correctly the first time).

## 6. Source map resolution library

**Decision (confirmed — spike passed)**: `@jridgewell/trace-mapping`. Tasks.md's T027 spike
verified this by construction: `worker/modules/ingest/sourcemap.ts` implements resolution with the
library, `tests/unit/sourcemap-resolve.test.ts` proves the VLQ decoding/`originalPositionFor` logic
against a real, hand-constructed Source Map v3 fixture (mappings `"AAAAA;GACE"`, checked in Deno's
V8), and — the actual Workers-runtime proof this spike exists to obtain —
`tests/contract/source-map-upload.spec.ts`'s second test runs the full path end-to-end against a
real `wrangler dev` instance: uploads a source map via the real endpoint, ingests a minified-frame
event referencing that release through the real public envelope endpoint, then asserts the issue
detail response's frame is correctly resolved (`resolved: true`, original `filename`/`function`).
All of this passed on the first attempt inside the real Workers runtime (workerd) — no fallback
decoder was needed.

**Rationale**: The research backing this decision could confirm the library's published
Node-independence claim but could not personally verify it executes inside a real Workers isolate —
treating that as settled without verification would risk discovering a runtime incompatibility mid
build-out, after other tasks already depend on it. The contract test above is that verification.

**Alternatives considered**: `source-map` (Mozilla's original library) — heavier, historically had a
WASM component in some versions (WASM works in Workers but adds cold-start/bundle-size cost the
pure-JS alternative avoids) — not chosen as the primary candidate but worth falling back to if both
`@jridgewell/trace-mapping` and a hand-rolled decoder run into trouble.

## 7. Source map storage and upload endpoint

**Decision**: R2 bucket (new binding, `SOURCE_MAPS`), object key scheme
`{project_id}/{release}/{sha256(minified-path-pattern)}`. D1 stores only metadata: `source_maps`
table with `project_id`, `release`, `minified_path_pattern`, `r2_object_key`, `uploaded_at`. Upload
endpoint is FlightDeck's own minimal shape — `POST /api/internal/projects/{id}/source-maps`
(sessionAuth-gated, since uploading is an operator/CI action against the control plane, not an
SDK-facing ingest action), accepting a release name, a path pattern, and the file body — **not**
sentry-cli's real endpoint shape (`POST /api/0/organizations/{org}/releases/{version}/files/`, which
assumes an "organizations" concept this product doesn't have). This divergence is deliberate and
constitution-sanctioned: Principle IV scopes full sentry-cli protocol compatibility to Module 5,
which may later wrap or supersede this endpoint with a real `sentry-cli`-compatible one — this
module's endpoint is not a promise of forward compatibility with that future shape.

**Rationale**: R2 is built for arbitrary-sized blobs; D1 rows are a poor fit for file content (source
maps can be hundreds of KB to low MB). Splitting storage this way mirrors how the events table
question (research.md §8) was resolved for the same underlying reason.

**Alternatives considered**: Storing source map content directly in a D1 `BLOB` column (rejected —
D1 is optimized for structured relational data, not arbitrary blob storage, and this would bloat the
database with content that's read rarely and only during symbolication, not on every query).

## 8. Event storage: D1 now, flagged for revisit

**Decision**: Store full raw event JSON in D1 (a `TEXT` column on the `events` table), not R2, for
this module. Events are typically small (a few KB — exception, stack trace, breadcrumbs, tags), well
within a reasonable D1 row size, and the issue detail view needs to query/read them directly without
a separate blob-fetch round-trip, which favors D1's structured access over R2's fetch-then-parse
pattern (the opposite tradeoff from source maps, which are larger and read far less often).

**Constitution Principle IX requires bounded-by-default retention, not "eventually"**: unbounded
event-row growth in D1 is not just a scaling concern here, it's a hard MUST ("retention windows...
MUST default to a bounded, documented period"). This was initially drafted as a deferred concern and
corrected mid-planning — this module now includes a scheduled retention job (a `scheduled` handler on
a daily Cron Trigger, per constitution Principle V's existing "single shared entry point" pattern for
scheduled work) that deletes `events` rows older than the default window (90 days — see spec.md's
Assumptions, matching the `FD_RETENTION_EVENTS` value Module 1 already documented on the
self-hosting page) without touching the owning `issues` row's summary fields (title, counts,
first/last-seen). FR-013's max payload size still caps the worst case per row independently of this.

**Still explicitly out of scope**: operator-configurable retention windows (a settings UI), and
per-project overrides — the 90-day default applies uniformly. Revisit if that becomes a real
requirement.

**Rationale**: Matches the actual read/write pattern (small rows, frequent structured reads) better
than R2 would, while being explicit that this isn't a permanent, fully-reasoned-through answer.

**Alternatives considered**: R2 for raw event JSON, D1 for just the issue-level aggregate (rejected
for this module — adds a blob round-trip to every issue-detail view for no benefit at this data
size/volume; revisit if/when retention becomes the actual next problem to solve).

## 9. Ingest write pattern: direct D1, no Queue yet

**Decision**: Ingest writes directly to D1 per event — no Cloudflare Queue buffering layer this
module.

**Rationale**: D1's single-writer semantics (SQLite over a Durable Object) only become a real
bottleneck at sustained volume in the tens-of-events/sec range or higher by engineering estimate —
this is an estimate based on D1's architecture, not an official Cloudflare-published number, and is
recorded as such rather than asserted as fact. That's well above what an early-stage product's real
usage needs. Cloudflare Queues (available on the free plan) is the documented upgrade path — a
"Workers ingest → Queue → consumer batches into D1" pattern — if/when volume actually approaches
that threshold, so this isn't a silent scaling cliff, just a deliberately deferred one.

**Alternatives considered**: Building the Queue-buffered pipeline now (rejected — premature for
current expected volume; adds a consumer Worker, batching logic, and a second failure mode to reason
about for a problem that doesn't exist yet).

## 10. Suspect commits: GitHub App, not PAT, and how the credential actually flows

**Decision**: A GitHub App (not a user-supplied Personal Access Token). The flow:
1. FlightDeck registers one GitHub App for the whole product (one-time, dashboard-side setup by the
   operator, not per-project) — this yields an **App ID** (non-secret) and a **private key** (a
   `.pem` file, stored as a single Worker secret, `GITHUB_APP_PRIVATE_KEY`, shared across every
   project's installations — it authenticates the app, not any individual repo connection).
2. A project owner "connects GitHub" by installing that App on their chosen repository (GitHub's own
   installation flow) — FlightDeck receives an **installation ID** back, which is stored per-project
   in the `repository_connections` D1 table (`project_id`, `owner`, `repo`, `installation_id`). The
   installation ID is not a secret — it's an identifier, like a project ID.
3. At suspect-commit lookup time (on demand, not stored long-term): sign a fresh, short-lived
   (≤10 min) App-level JWT using `GITHUB_APP_PRIVATE_KEY`, exchange it via
   `POST /app/installations/{installation_id}/access_tokens` for a short-lived (1h) installation
   access token, then call `GET /repos/{owner}/{repo}/commits?path={file}` with that token. The
   installation access token itself is never persisted — it's minted on demand and discarded (an
   in-memory or short-TTL cache within a single warm isolate is a reasonable optimization, not stored
   in D1).

**Rationale**: This is the only design that avoids storing a long-lived, broadly-scoped credential
per project (constitution Principle IX). The only durable secret is the single App private key,
already Worker-secret-only per Principle IX's existing discipline; everything per-project is either
a non-secret identifier (installation ID) or a token that expires within the hour and is never
written to storage.

**Alternatives considered**: User-supplied PAT stored per-project in D1 (rejected — a classic PAT is
broadly scoped to everything the user's GitHub account can see unless they hand-craft a fine-grained
one; storing it long-term in D1, even "just" for this feature, is exactly the kind of standing
credential exposure Principle IX asks to avoid, and it doesn't auto-rotate or get scoped down by
GitHub the way an App installation does).

## 11. App-shell issue-detail navigation

**Decision**: Keep Module 1's `AppShell.tsx` component-state-based screen switching (no URL routing
introduced for app-shell sub-screens) — add one more piece of local state, `selectedIssueId`,
alongside the existing `screen` state. Clicking an issue in the list sets
`screen: "issue-detail"` and `selectedIssueId: <id>`; the issue list and detail screens are both
plain components reading that state, matching every other screen Module 1 already built.

**Rationale**: Module 1's research.md §4 deliberately chose a hand-rolled, non-URL-routed approach
for the app shell's internal navigation (reasoning: small, fixed screen count, no router library
needed) — adding a parameterized screen doesn't invalidate that reasoning, since the actual
mechanism (component state driving which screen renders) doesn't change, only the data it carries.
Introducing real URL-based routing for individual issues (e.g. `/web-app/issues/:id`, enabling
shareable/bookmarkable links) is a legitimate future improvement, but nothing in spec.md's
acceptance scenarios requires deep-linking to a specific issue — adding it now would be scope
creep against an unstated requirement, and would mean partially contradicting Module 1's still-valid
router decision instead of extending it.

**Alternatives considered**: Introducing `/web-app/issues/:id` URL routing now (rejected for this
module on scope grounds, not technical grounds — flagged here so it isn't silently forgotten if
shareable issue links become a real requirement later).
