# Feature Specification: Releases

**Feature Branch**: `005-releases`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Module 5 — Releases (adoption, crash-free sessions, regression
detection, sentry-cli-compatible release/source-map upload)." (full brief in conversation history,
including protocol grounding researched against sentry-cli's real command surface and Sentry's REST
API reference, and scope decisions already made — see plan.md's Technical Context and research.md
for the detailed technical record)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ship a release through existing CI tooling, unmodified (Priority: P1)

A developer's CI pipeline already runs `sentry-cli` to create a release, upload its source maps,
and finalize it. Pointed at FlightDeck instead of Sentry (just an endpoint and token change, no
pipeline rewrite), it works exactly the same way.

**Why this priority**: This is the entire value proposition named in this module's core
requirement — "point existing tooling at a new endpoint" is the same promise Module 2 made for
SDKs, applied here to release tooling. Nothing else in this module matters if a real CI pipeline's
`sentry-cli` invocation doesn't actually work against FlightDeck.

**Independent Test**: Configure a real `sentry-cli` installation with FlightDeck's endpoint and an
API token, run its standard release flow (create a release, upload source maps for it, finalize
it) against a project, and confirm the release and its source maps appear correctly in the
dashboard — matching what a subsequently-ingested minified-stack-trace error resolves against.

**Acceptance Scenarios**:

1. **Given** a project with an API token generated for it, **When** `sentry-cli releases new
   <version>` runs against FlightDeck, **Then** a release with that version is created for the
   project(s) specified.
2. **Given** an existing release, **When** `sentry-cli releases files <version>
   upload-sourcemaps <path>` runs, **Then** the uploaded source maps are associated with that
   release, usable for stack-trace resolution exactly as if uploaded through the dashboard.
3. **Given** an existing release, **When** `sentry-cli releases finalize <version>` runs, **Then**
   the release is marked as finalized with its release date recorded.
4. **Given** an invalid or missing API token, **When** any release-management command runs,
   **Then** it is rejected and no data is created or modified.

---

### User Story 2 - See how a release is actually performing (Priority: P1)

A developer opens the Releases screen and sees, for each release, how widely it's been adopted and
how stable it's been — without needing to cross-reference raw session data themselves.

**Why this priority**: Equally core to this module's value as User Story 1 — shipping a release
compatibly (US1) only matters if a developer can then tell whether that release is actually healthy.
Rated alongside US1, not below it, since a release-shipping mechanism with no visibility into the
result is only half the feature.

**Independent Test**: Ingest a known set of session outcomes (some crashed, most not) tagged to a
specific release, and confirm the dashboard's adoption percentage and crash-free rates for that
release match the known distribution.

**Acceptance Scenarios**:

1. **Given** sessions reported for a release, **When** viewing the Releases screen, **Then** that
   release shows its adoption (share of recent sessions on it) and crash-free session/user rates.
2. **Given** a release with no sessions reported yet, **When** viewing it, **Then** it shows an
   honest "no data yet" state rather than a misleading 100%/0% figure.
3. **Given** multiple releases across different environments, **When** viewing a specific release's
   detail, **Then** its health figures are broken down per environment, not blended together.

---

### User Story 3 - Know when a fixed bug comes back (Priority: P2)

A developer marks an issue resolved after shipping a fix — either "resolved" outright or "resolved
in the next release." If the same underlying bug occurs again in a later release, the issue
automatically reopens instead of silently staying marked as fixed.

**Why this priority**: Builds directly on User Story 1 (releases must exist and be ordered) and
Module 2's existing issue model — genuinely valuable but not required for either shipping releases
or seeing their health, so correctly sequenced after both.

**Independent Test**: Resolve an issue against a specific release, then ingest a new occurrence of
the same underlying error tagged with a later release, and confirm the issue automatically reopens
(and does NOT reopen for a new occurrence tagged with the SAME or an EARLIER release).

**Acceptance Scenarios**:

1. **Given** an unresolved issue, **When** a developer resolves it (either mode), **Then** it no
   longer appears in the default active-issues view.
2. **Given** an issue resolved at a specific release, **When** a new occurrence arrives tagged with
   a later release, **Then** the issue automatically reopens.
3. **Given** an issue resolved "in the next release," **When** a new occurrence arrives tagged with
   a release created after the resolution, **Then** the issue automatically reopens.
4. **Given** an issue resolved at a specific release, **When** a new occurrence arrives tagged with
   that same release or an earlier one, **Then** the issue does NOT reopen (the resolution still
   holds — this is expected, not a regression).

---

### User Story 4 - Attribute a release to its commits and deploys (Priority: P3)

A developer's CI pipeline also records which commits went into a release and when it was deployed
to each environment, via the same `sentry-cli` tooling, and can browse or clean up releases from
the command line.

**Why this priority**: Useful context (who changed what, when it shipped where) but neither shipping
a release (US1) nor seeing its health (US2) nor regression detection (US3) depends on it — the
smallest-audience slice of this module's sentry-cli surface.

**Independent Test**: Run `sentry-cli releases set-commits` and `sentry-cli releases deploys new`
against a real release, and `sentry-cli releases list`/`delete` for basic CLI-driven management,
confirming each reflects correctly in the dashboard.

**Acceptance Scenarios**:

1. **Given** a release and a connected GitHub repository, **When** `sentry-cli releases
   set-commits` runs, **Then** the commits between the specified range are associated with the
   release and visible on its detail view.
2. **Given** an existing release, **When** `sentry-cli releases deploys new` runs for a specific
   environment, **Then** that deploy is recorded and visible on the release's detail view.
3. **Given** existing releases, **When** `sentry-cli releases list`/`delete` run, **Then** they
   correctly list/remove releases via the same API a dashboard user's view is backed by.

### Edge Cases

- A release-management request's API token is valid but has been revoked since the CI pipeline last
  cached it: the request is rejected the same as an invalid token, not accepted on stale trust.
- A release is created for a project that doesn't exist (or the caller's token doesn't grant access
  to): the request is rejected without creating a release.
- The same release version is created twice for the same project (e.g. a retried CI step): this is
  a no-op against the existing release, not a duplicate or an error.
- A source map is uploaded for a release that doesn't exist yet: the release is implicitly
  recognized, matching the same behavior Module 2 already established for its own upload path.
- An issue is resolved "in the next release," but no later release has been created yet when a new
  occurrence of the same bug arrives: the issue does NOT reopen (there is no "next release" for it
  to have regressed against yet).
- Session data arrives for a release/environment combination that hasn't been seen before: it's
  accepted and a new aggregate record starts, not rejected for referencing an unknown combination.
- An API token is used for an action beyond release management (e.g. attempting to read arbitrary
  issue data): rejected — the token's authority is scoped to release-management actions, not
  general dashboard access.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow generating and revoking API tokens, scoped to release-management
  actions, that authenticate an external CLI tool the same way `sentry-cli` itself authenticates
  against Sentry.
- **FR-002**: The system MUST reject, without creating or modifying any data, any release-management
  request whose API token is missing, invalid, or revoked.
- **FR-003**: The system MUST allow creating a release, uploading source maps for it, and finalizing
  it, through requests shaped to match `sentry-cli`'s real, unmodified command output — no
  FlightDeck-specific CLI or wrapper required.
- **FR-004**: The system MUST NOT create a duplicate release when the same version is submitted more
  than once for the same project.
- **FR-005**: The system MUST accept session-outcome data per release and environment, and compute
  from it each release's adoption share and crash-free session/user rates.
- **FR-006**: The system MUST present release health (adoption, crash-free rates) per release,
  broken down per environment, showing an honest "no data" state rather than misleading figures when
  no session data exists yet for a given release.
- **FR-007**: The system MUST allow marking an issue resolved, in either of two modes: resolved as
  of a specific release, or resolved as of whichever release comes next.
- **FR-008**: The system MUST automatically reopen a resolved issue when a new occurrence of it is
  reported tagged with a release that is later than the release the resolution referenced — and
  MUST NOT reopen it for an occurrence tagged with the same or an earlier release.
- **FR-009**: The system MUST allow associating a range of commits with a release and recording a
  release's deployment to a given environment, through the same `sentry-cli`-compatible request
  shapes real tooling produces.
- **FR-010**: The system MUST allow listing and deleting releases through the same
  `sentry-cli`-compatible interface.
- **FR-011**: Every release-management action performed via an API token MUST be attributable, after
  the fact, to the account that generated the token used.

### Key Entities *(include if feature involves data)*

- **Release** (extends Module 2's entity): gains a resolved date, associated commits, and recorded
  deploys.
- **Release Health**: an aggregate record of session outcomes for one release in one environment,
  over time — session/user counts, crash counts, from which adoption and crash-free figures are
  derived. Not a record of individual sessions.
- **Deploy**: a record that a specific release was deployed to a specific environment at a specific
  time.
- **API Token**: a credential, generated by an authenticated account, scoped to release-management
  actions, revocable, attributable back to the account that generated it.
- **Issue** (extends Module 2's entity): gains a resolution status — unresolved, or resolved against
  a specific release (either directly, or "as of the next release").

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An unmodified `sentry-cli` release flow (create, upload source maps, finalize)
  completes successfully against FlightDeck with only an endpoint and token change from a real
  Sentry configuration.
- **SC-002**: A release's adoption and crash-free figures, computed from a known set of ingested
  session outcomes, are numerically correct, verified by automated test.
- **SC-003**: 100% of release-management requests with an invalid or revoked API token are rejected
  with no data change, verified by automated test.
- **SC-004**: An issue resolved at a release automatically and correctly reopens when the same bug
  recurs in a later release, and correctly stays resolved for the same or an earlier release,
  verified by automated test against both cases.
- **SC-005**: A developer can go from generating an API token to a completed, verified CI release
  flow without needing to consult anything beyond `sentry-cli`'s own standard documentation.

## Assumptions

- "Unmodified `sentry-cli`" means the current stable version, configured via its standard
  `SENTRY_URL`/`SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` mechanism — not a FlightDeck-specific
  fork or wrapper.
- FlightDeck has no organizations concept; wherever `sentry-cli`'s protocol requires an
  organization-slug-shaped value, FlightDeck accepts it as a required-but-unvalidated pass-through
  rather than implementing real multi-organization support — this is a deliberate, documented
  protocol accommodation, not a gap to close later in this module.
- Regression detection and the resolve action are scoped to the minimum needed to make regression
  detection real: a bare resolved/unresolved status with the two resolution modes named above.
  `ignore`/`snooze` semantics and issue assignment are explicitly out of scope for this module.
- Crash-free rate calculation uses the standard, industry-understood definitions (crash-free session
  rate, crash-free user rate) rather than a bespoke formula.
- Release health is tracked at daily-aggregate granularity per release/environment, not
  individual-session granularity — sufficient for the adoption/crash-free figures this module's
  scope requires; no UI for browsing individual raw sessions is part of this module.
- The existing demo project (seeded in Module 1, DSN-issued in Module 2) is an acceptable target for
  this module's end-to-end testing.
