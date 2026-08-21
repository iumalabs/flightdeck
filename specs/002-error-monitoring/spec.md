# Feature Specification: Error Monitoring

**Feature Branch**: `002-error-monitoring`

**Created**: 2026-08-21

**Status**: Draft

**Input**: User description: "Module 2 — Error monitoring (Sentry-protocol-compatible ingest for
JavaScript/browser and Python SDKs, issue grouping, source map resolution, suspect commits)." (full
brief in conversation history, including protocol grounding researched against real Sentry
developer docs and scope decisions already made — see plan.md's Technical Context and research.md
for the detailed technical record)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See production errors as grouped issues (Priority: P1)

A developer who already uses a Sentry SDK in their JavaScript/browser or Python application points
its DSN at their FlightDeck project. Without changing any other code, errors their application
raises start appearing in FlightDeck as issues — grouped so the same underlying bug across many
occurrences is one issue, not hundreds.

**Why this priority**: This is the entire value proposition of Module 2 and the product's core
promise ("point an existing Sentry SDK at a new DSN"). Nothing else in this module matters if
events don't reliably arrive and group sensibly.

**Independent Test**: Configure a real `@sentry/browser`-family SDK and a real `sentry-sdk` (Python)
instance, each pointed at a FlightDeck project's DSN, trigger a handled exception from each, and
confirm both appear as issues in the dashboard within seconds — including confirming that
triggering the *same* JS error twice increments one issue's event count rather than creating a
second issue.

**Acceptance Scenarios**:

1. **Given** a project's DSN configured in a real browser-based Sentry SDK, **When** the
   application throws an unhandled or captured exception, **Then** a corresponding issue appears in
   that project's Issues list within seconds, showing the exception type/message, the culprit
   location, and an event count of 1.
2. **Given** a project's DSN configured in a real Python Sentry SDK, **When** the application raises
   a captured exception, **Then** the same behavior occurs as in Scenario 1, from the same Issues
   list.
3. **Given** an issue already exists from a specific error, **When** the same underlying error
   occurs again (same exception type and stack shape), **Then** the existing issue's event count
   increments and its "last seen" time updates, rather than a new issue being created.
4. **Given** a request arrives at the ingest endpoint with a missing, unknown, or invalid DSN key,
   **When** the request is processed, **Then** it is rejected and no issue or event is recorded.
5. **Given** a project is receiving an unusually high rate of events, **When** the rate limit is
   exceeded, **Then** further events for that project are rejected with a response the SDK
   recognizes as "back off," and the SDK's own client-side backoff behavior is honored on the next
   request.

---

### User Story 2 - Diagnose an issue from its detail view (Priority: P2)

A developer clicks into an issue from the list to see everything needed to diagnose it: the full
stack trace, the breadcrumbs leading up to the error, and any tags/context the SDK attached.

**Why this priority**: A grouped issue list (User Story 1) tells a developer *that* something is
wrong and roughly how often; the detail view is what actually lets them fix it. Rated below User
Story 1 because an issue list with accurate counts is independently useful even before the detail
view exists, whereas the detail view has nothing to show without User Story 1 first.

**Independent Test**: From a real ingested event (User Story 1's test setup), open its issue and
confirm the stack trace, breadcrumbs, and context recorded by the SDK are all visible and
attributed to the correct frame/step.

**Acceptance Scenarios**:

1. **Given** an issue with at least one recorded event, **When** a developer opens the issue detail
   view, **Then** the full stack trace is shown with each frame's file, function, and line
   information as reported by the SDK.
2. **Given** an event that included breadcrumbs (e.g. navigation or logged actions leading up to the
   error), **When** viewing the issue detail, **Then** those breadcrumbs are shown in chronological
   order.
3. **Given** an event that included custom tags or context set by the SDK, **When** viewing the
   issue detail, **Then** that tag/context data is visible.

---

### User Story 3 - Read original source instead of minified code (Priority: P2)

A developer whose JavaScript build is minified uploads the source map produced by their build for a
given release. Stack traces for errors from that release now show the original file, function name,
and line — not the minified equivalent.

**Why this priority**: Minified stack traces are frequently useless for diagnosis on their own — this
is what makes the detail view (User Story 2) actually actionable for a production JS build, which is
the common case. Rated alongside User Story 2 rather than above it because the detail view itself
must exist first to have something to resolve traces *into*.

**Independent Test**: Ingest an error whose stack trace references a minified file/line, upload that
build's source map for the matching release, and confirm the issue's stack trace now shows the
original source location instead of the minified one — without needing to re-trigger the error.

**Acceptance Scenarios**:

1. **Given** a release with an uploaded source map, **When** an event tagged with that release and a
   minified stack trace is ingested, **Then** the resulting issue's stack trace shows original
   file/function/line, not the minified equivalent.
2. **Given** two minified builds of the same underlying bug (e.g. two releases where a hash in the
   minified filename differs), **When** both are ingested with their respective source maps
   available, **Then** they resolve to the same issue rather than two separate ones.
3. **Given** an event references a release with no uploaded source map, **When** it is ingested,
   **Then** the issue still records normally, showing the raw (minified) stack trace rather than
   failing to ingest the event at all.

---

### User Story 4 - See who likely caused an issue (Priority: P3)

A developer connects their project to a GitHub repository. From then on, issues whose culprit frame
maps to a file in that repository show a likely-responsible commit, so the developer knows who to
ask or assign the issue to.

**Why this priority**: Genuinely useful for triage in a team setting, but an issue is fully
diagnosable without it (Users Stories 1–3 already provide the stack trace and context). Lowest
priority because it's the most infrastructure-heavy addition (external repo connection) for the
smallest marginal diagnostic value versus User Stories 1–3.

**Independent Test**: Connect a real (test) GitHub repository to a project, ingest an event whose
culprit frame's file path exists in that repository, and confirm the issue shows a specific commit
as the suspect, matching the actual most recent commit that touched that file in the repository.

**Acceptance Scenarios**:

1. **Given** a project with a connected GitHub repository, **When** an issue's culprit frame's file
   path matches a file in that repository, **Then** the issue detail shows the most recent commit
   that modified that file as the suspect commit, with enough information (author, message, commit
   reference) to act on it.
2. **Given** a project with no connected repository, **When** viewing any issue, **Then** no suspect
   commit section is shown (not an error state — simply absent).
3. **Given** a connected repository whose stored access credential has been revoked or expired,
   **When** an issue is viewed that would otherwise show a suspect commit, **Then** the suspect
   commit is silently omitted rather than the issue detail view failing to load.

### Edge Cases

- An ingest request's envelope is malformed (invalid JSON, truncated body, missing required
  headers): the request is rejected without crashing the ingest pipeline or affecting other
  projects' ingestion.
- An event has no stack trace at all (message-only capture): it still groups and displays, using the
  message rather than the (absent) stack trace as the basis for grouping.
- An event explicitly supplies its own fingerprint: that fingerprint is honored over the automatic
  stack-trace-based grouping.
- The same event is submitted twice (e.g. a client retry after a network blip): it is not recorded
  as two separate occurrences of the issue.
- A source map is uploaded for a release that doesn't exist yet: the release is implicitly
  recognized rather than the upload being rejected for referencing an unknown release.
- A suspect-commit lookup's file path doesn't exist in the connected repository (e.g. renamed or
  deleted since): no suspect commit is shown for that issue, not an error.
- An ingest payload is excessively large (e.g. an oversized breadcrumb trail or var dump): it is
  rejected rather than accepted and allowed to degrade ingest performance for other projects.
- An issue's only recorded occurrence ages past the retention window: the issue itself (title,
  culprit, counts, first/last-seen) remains visible and intact — only the detailed occurrence data
  is pruned, and the issue detail view degrades gracefully (e.g. showing that detailed event data is
  no longer retained) rather than the issue disappearing or the view erroring.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept error events from an unmodified, standard browser/JavaScript
  Sentry SDK and an unmodified, standard Python Sentry SDK, authenticated solely by the project's
  DSN — no FlightDeck-specific code changes required in the instrumented application.
- **FR-002**: The system MUST reject, without recording an event, any ingest request whose DSN key
  is missing, unrecognized, or does not resolve to an active project.
- **FR-003**: The system MUST group incoming events into issues automatically, such that repeated
  occurrences of the same underlying error increment one issue's count rather than creating
  duplicate issues, using the error's stack trace as the primary grouping signal when one is
  present, an explicit client-supplied grouping key when provided, and the error message as a
  fallback when no stack trace exists.
  - **Design note carried from research**: when a usable source map exists for the event's release,
    grouping decisions MUST be made using the *resolved* (original-source) stack trace, not the raw
    minified one — otherwise the same logical bug in different minified builds groups as separate
    issues. See User Story 3, Acceptance Scenario 2.
- **FR-004**: The system MUST limit the rate of events accepted per project and, when that limit is
  exceeded, reject further events in a way the sending SDK recognizes as a rate-limit signal (so the
  SDK's own built-in backoff behavior activates) rather than as a generic failure.
- **FR-005**: The system MUST present an issue list per project showing, at minimum, each issue's
  title, culprit location, severity level, and event count, ordered so the most recently active
  issues are easy to find.
- **FR-006**: The system MUST present an issue detail view showing the full stack trace, any
  breadcrumbs recorded on the triggering event, and any custom tags/context the SDK attached.
- **FR-007**: The system MUST allow uploading a source map for a specific release, and MUST use an
  uploaded source map to resolve minified stack frames (file, function, line) to their original
  source equivalents in the issue detail view for events belonging to that release.
- **FR-008**: The system MUST continue to accept and display events whose release has no uploaded
  source map, showing the raw stack trace rather than failing ingestion.
- **FR-009**: The system MUST allow connecting exactly one GitHub repository per project as the
  source for suspect-commit lookups.
- **FR-010**: When a project has a connected repository, the system MUST show, on an issue whose
  culprit frame's file path exists in that repository, the most recent commit that modified that
  file as the issue's suspect commit.
- **FR-011**: The system MUST NOT show a suspect commit, and MUST NOT fail to display the rest of
  the issue, when no repository is connected, the file path isn't found in the repository, or the
  stored repository credential has stopped working.
- **FR-012**: The system MUST issue a real, usable DSN (project public key) for at least the
  existing demo project, sufficient to exercise every other requirement in this module end to end
  without requiring a separate project-creation flow.
- **FR-013**: The system MUST reject ingest payloads beyond a defined maximum size rather than
  accepting arbitrarily large payloads.
- **FR-014**: The system MUST NOT record a second occurrence for an event the sending SDK has
  already successfully submitted (e.g. a retried request for the same event), so retries don't
  inflate an issue's event count.
- **FR-015**: The system MUST automatically delete individual error occurrences older than a
  bounded, documented default age, without requiring a person to trigger cleanup manually. Deleting
  old occurrences MUST NOT delete the issue they belonged to, its summary counts, or its most recent
  occurrence.

### Key Entities *(include if feature involves data)*

- **Project** (extends Module 1's entity): gains a DSN public key, making it a real ingest target
  rather than a display-only placeholder.
- **Issue**: a grouped bucket of one or more error occurrences sharing a fingerprint — title,
  culprit, level, first-seen/last-seen times, event count, current fingerprint.
- **Event**: one raw occurrence belonging to an issue — the full payload reported by the SDK
  (exception/stack trace, breadcrumbs, tags, context, release, environment, timestamp).
- **Release**: a named version string scoping events, source maps, and (indirectly, via commit
  lookups) suspect-commit resolution to a specific build of the application.
- **Source Map**: an uploaded build artifact associated with a release and a minified file path
  pattern, used to resolve stack frames from that release's events.
- **Repository Connection**: a project's link to one external GitHub repository, including whatever
  credential is needed to read commit history from it, used only for suspect-commit lookups.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from installing a standard Sentry SDK and setting the DSN to seeing
  their first triggered error appear as an issue in under 30 seconds.
- **SC-002**: 100 occurrences of the same underlying error produce exactly one issue with an event
  count of 100, not multiple issues — verified by automated test, not manual spot-checking.
- **SC-003**: 100% of ingest requests with an invalid or unrecognized DSN are rejected with no data
  recorded, verified by automated test.
- **SC-004**: A developer viewing an issue with an uploaded source map for its release sees original
  (non-minified) file/function/line information for every frame the source map covers.
- **SC-005**: A developer can connect a GitHub repository to a project and see a suspect commit on a
  qualifying issue without needing to manually search commit history themselves.
- **SC-006**: Under sustained event volume consistent with an early-stage product's real usage (not
  a load-test-scale burst), issue counts and last-seen times stay accurate with no observable
  ingestion backlog.

## Assumptions

- "Unmodified, standard Sentry SDK" means the current stable major version of `@sentry/browser` (or
  the browser-family SDKs built on it, e.g. `@sentry/react`) and `sentry-sdk` (Python) as of this
  module's implementation — not every historical SDK version ever released.
- The existing demo project (seeded in Module 1) is an acceptable target for this module's DSN
  issuance and end-to-end testing; a full multi-project creation UI remains out of scope, per the
  constitution's module roadmap (a later module's job).
- Suspect-commit resolution uses a file-path-level heuristic (most recent commit touching the
  culprit file), not line-level `git blame` — sufficient for the stated diagnostic value at this
  stage; a more precise blame-based approach is a possible future refinement, not a gap to close now.
- Rate limits, maximum payload size, and other numeric thresholds are implementation-appropriate
  defaults tuned during planning (research.md/plan.md), not user-facing configuration in this
  module — operators cannot yet adjust them from the UI.
- The default event-retention window is 90 days — consistent with the `FD_RETENTION_EVENTS` example
  value already documented on the self-hosting page shipped in Module 1. Making it operator-
  configurable from the UI is not required by this module.
- Distributed tracing, structured logs, releases-as-a-standalone-feature (adoption/crash-free
  tracking), uptime monitoring, and user feedback are explicitly out of scope, per the constitution's
  module roadmap — this module's "release" concept exists only as far as source maps and suspect
  commits need it.
