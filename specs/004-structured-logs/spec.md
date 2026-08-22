# Feature Specification: Structured Logs

**Feature Branch**: `004-structured-logs`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Module 4 — Structured logs (live tail, search, retention,
S3-compatible export)." (full brief in conversation history, including protocol grounding researched
against real Sentry developer docs, Cloudflare live-tail/search/export research, and scope decisions
already made — see plan.md's Technical Context and research.md for the detailed technical record)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Watch logs arrive in real time (Priority: P1)

A developer who already uses a Sentry SDK enables structured logging (the SDK's standard logging
option). Without changing any other code, log lines their application emits appear in FlightDeck's
dashboard within moments of being emitted, as a live, scrolling stream — not something the developer
has to refresh to see.

**Why this priority**: This is the entire value proposition named first in this module's scope
("live tail") — a developer actively debugging a live issue wants to watch logs as they happen, not
wait for a batch job. Nothing else in this module matters if log lines don't reliably arrive and
stream live.

**Independent Test**: Configure a real `@sentry/browser`-family SDK and a real `sentry-sdk` (Python)
instance, both with logging enabled and pointed at a project's DSN, open that project's live tail
view in the dashboard, trigger log-emitting activity in each application, and confirm the log lines
appear in the live view within seconds, correctly attributed (level, message, source SDK).

**Acceptance Scenarios**:

1. **Given** a project's live tail view is open, **When** an instrumented application emits a log
   line, **Then** that log line appears in the view within seconds, showing at minimum its level,
   message, and timestamp.
2. **Given** a live tail view showing a mix of levels, **When** a developer filters by level (e.g.
   only `error`/`fatal`), **Then** only log lines matching that filter continue to appear as new
   ones arrive.
3. **Given** a request arrives at the ingest endpoint with a missing, unknown, or invalid DSN key,
   **When** the request is processed, **Then** it is rejected and no log data is recorded or
   broadcast.
4. **Given** a project is receiving an unusually high rate of log submissions, **When** that rate
   limit is exceeded, **Then** further log submissions for that project are rejected in a way the
   sending SDK recognizes as a rate-limit signal — independently of whether that project's error or
   trace ingestion is also currently rate-limited, since log volume and error/trace volume are
   unrelated to each other.

---

### User Story 2 - Find what happened after the fact (Priority: P1)

A developer investigating an issue searches their project's log history — by text, by level, by time
range — to find the log lines relevant to what went wrong, without needing to have had the live tail
view open at the time.

**Why this priority**: Live tail (User Story 1) only helps if a developer happens to be watching at
the right moment; most real investigation happens after the fact. This is equally core to the
module's value, not a lesser feature — a logging product that only shows what's happening live, with
no way to look back, isn't useful for post-incident investigation.

**Independent Test**: Ingest a batch of log lines with varied content and levels, then search by a
distinctive word from one of them, confirm it's found; filter by level and by a time range, confirm
only matching lines are returned.

**Acceptance Scenarios**:

1. **Given** previously ingested log lines, **When** a developer searches for a distinctive word or
   phrase, **Then** log lines whose message or attributes contain that text are returned.
2. **Given** previously ingested log lines at multiple levels, **When** a developer filters by
   level, **Then** only log lines at that level are returned.
3. **Given** previously ingested log lines across a wide time span, **When** a developer narrows to
   a specific time range, **Then** only log lines within that range are returned.
4. **Given** a search matching no log lines, **When** the search runs, **Then** the result is an
   honest empty state, not an error.

---

### User Story 3 - Jump between a trace and its logs (Priority: P2)

A developer viewing a trace (Module 3) sees the log lines that were emitted during it; a developer
viewing a log line sees which trace it happened during and can jump to that trace's waterfall.

**Why this priority**: This is the constitution's "shared identifiers" promise extended one hop
further than Module 3 already took it (error ↔ trace). Genuinely useful once both traces and
searchable logs exist independently, but neither is blocked waiting for it — correctly sequenced
after User Story 2, since finding "logs during this trace" is itself a specific case of search.

**Independent Test**: Ingest a trace and log lines sharing the same trace identifier (as a real SDK
produces when logging happens during a traced operation), and confirm each side's detail view links
to the other.

**Acceptance Scenarios**:

1. **Given** a trace during which log lines were emitted, **When** a developer views that trace's
   detail, **Then** the log lines emitted during it are shown, leading to the full log search/detail
   context around them.
2. **Given** a log line emitted during an active trace, **When** a developer views that log line,
   **Then** a reference to the originating trace is shown and leads to that trace's waterfall.
3. **Given** a trace during which no logs were emitted, or a log line emitted with no active trace,
   **When** viewing either side, **Then** no cross-link is shown (not an error state — simply
   absent).

---

### User Story 4 - Take log data elsewhere (Priority: P3)

An operations team archives their project's log history to their own storage, or feeds it into their
own external tooling, using standard S3-compatible clients rather than a FlightDeck-specific export
mechanism.

**Why this priority**: Valuable for teams with compliance/retention needs beyond FlightDeck's own
window, or who want to feed logs into their own analytics — but nothing else in this module depends
on it, and it's the smallest-audience feature of the four named in this module's scope.

**Independent Test**: Provision export access for a project, and confirm a standard S3-compatible
client (not a FlightDeck-specific tool) can list and retrieve that project's archived log data using
the provided credentials.

**Acceptance Scenarios**:

1. **Given** a project with export access provisioned, **When** a developer uses a standard
   S3-compatible client with the provided credentials, **Then** they can list and download that
   project's archived log data, and only that project's data.
2. **Given** a project with no export access provisioned, **When** checking for export credentials,
   **Then** none are available (not a broken/error state — simply not provisioned).

### Edge Cases

- An ingest request's envelope is malformed (invalid JSON, truncated body, missing required
  headers): the request is rejected without crashing the ingest pipeline or affecting other
  projects' ingestion — the same guarantee already established for error and trace ingest.
- A single submission contains many log lines at once (an SDK batches its buffered logs before
  sending): all of them are recorded, not just the first or a truncated subset, up to the defined
  maximum submission size.
- The same log submission is received twice (e.g. a client retry after a network blip): log lines
  are not duplicated in search results or live tail.
- No one has the live tail view open when a log line arrives: the log line is still durably recorded
  and later findable via search — live tail is a real-time convenience, not the only way logs are
  captured.
- A search query matches an extremely large number of log lines: results are returned in a bounded,
  paginated way rather than attempting to return everything at once.
- Log lines carry no trace correlation (emitted with no active trace): they are still fully visible
  in live tail and search, just without a trace cross-link (User Story 3).
- An ingest payload is excessively large (e.g. an unusually large batch of log lines or oversized
  attributes): it is rejected rather than accepted and allowed to degrade ingest performance for
  other projects.
- Log data ages past the retention window: it is fully removed (live tail, search, and export all
  stop reflecting it) — no partial-preservation guarantee, unlike Module 2's issue/event split,
  since a log line has no separate summary record to preserve.
- Export credentials are compromised or need to be revoked: revoking them stops all further access
  without affecting the underlying log data or any other project's export access.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST accept structured log submissions from an unmodified, standard
  browser/JavaScript Sentry SDK and an unmodified, standard Python Sentry SDK with logging enabled,
  authenticated solely by the project's DSN — no FlightDeck-specific code changes required in the
  instrumented application.
- **FR-002**: The system MUST reject, without recording any log data, any log-ingest request whose
  DSN key is missing, unrecognized, or does not resolve to an active project.
- **FR-003**: The system MUST limit the rate of log submissions accepted per project, independently
  of that project's error and trace rate limits, and reject further submissions once exceeded in a
  way the sending SDK recognizes as a rate-limit signal.
- **FR-004**: The system MUST provide a live view per project showing newly arriving log lines in
  real time, filterable by level, without requiring the viewer to manually refresh.
- **FR-005**: The system MUST durably record every accepted log line regardless of whether anyone is
  viewing the live view at the time it arrives.
- **FR-006**: The system MUST provide search over a project's log history by free-text content,
  filterable by level and by time range, returning results in a bounded, paginated way.
- **FR-007**: The system MUST link a log line to the trace that was active when it was emitted, when
  the SDK provided that association, and make that link navigable from both the log line and the
  trace's own detail view.
- **FR-008**: The system MUST NOT show a trace link on a log line, or a log listing on a trace, when
  no such association exists — absent, not an error state.
- **FR-009**: The system MUST NOT record a second occurrence of a log line submission the sending
  SDK has already successfully submitted (e.g. a retried request), so retries don't duplicate
  results in live tail or search.
- **FR-010**: The system MUST reject log-ingest payloads beyond a defined maximum size rather than
  accepting arbitrarily large submissions.
- **FR-011**: The system MUST automatically delete log data older than a bounded, documented default
  age, without requiring a person to trigger cleanup manually.
- **FR-012**: The system MUST allow provisioning S3-compatible export access scoped to a single
  project's log data, such that a standard S3-compatible client can list and retrieve that data
  using the provided credentials, without exposing any other project's data through the same
  credentials.
- **FR-013**: The system MUST allow revoking previously provisioned export access, after which
  further access attempts with the revoked credentials fail.

### Key Entities _(include if feature involves data)_

- **Log line**: one structured log entry — timestamp, level, message, optional structured
  attributes, and (when available) the trace/span it was emitted during.
- **Log batch**: an internal grouping of log lines recorded together for storage/search purposes —
  not a concept the end user interacts with directly, but relevant to how retention and search
  results are actually produced.
- **Export credential**: a project-scoped, revocable set of access details granting S3-compatible
  read access to that project's archived log data.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A developer can go from enabling logging in a standard Sentry SDK to seeing their
  first log line in FlightDeck's live tail view in under 10 seconds.
- **SC-002**: A search for a distinctive term correctly finds the log lines containing it and
  excludes those that don't, verified by automated test against a known set of ingested lines.
- **SC-003**: 100% of log-ingest requests with an invalid or unrecognized DSN are rejected with no
  data recorded, verified by automated test.
- **SC-004**: A burst of log traffic for one project does not cause that project's error or trace
  ingestion to be rate-limited, and vice versa, verified by automated test.
- **SC-005**: A developer viewing a trace with associated log activity can reach those log lines in
  one step, and vice versa from a log line to its trace.
- **SC-006**: A provisioned S3-compatible export credential can list and retrieve exactly one
  project's log data and no other project's, verified by automated test.
- **SC-007**: Under sustained log volume consistent with an early-stage product's real usage (not a
  load-test-scale burst), live tail and search stay responsive with no observable ingestion backlog.

## Assumptions

- "Unmodified, standard Sentry SDK" carries the same meaning established in Modules 2-3: the current
  stable major version of `@sentry/browser` (or `@sentry/react`) and `sentry-sdk` (Python), with
  structured logging enabled via each SDK's standard logging option.
- The default log-retention window is shorter than Module 2's 90-day event retention and Module 3's
  30-day transaction retention, given log data's structurally higher volume — the exact number is an
  implementation default tuned during planning, not user-facing configuration in this module.
- Search covers log message content and structured attribute values; it does not need to support a
  structured query language (field:value syntax, boolean operators) in this module's MVP — free-text
  plus level/time-range filters is sufficient.
- Export access provisioning produces credentials usable by generic S3-compatible tooling; this
  module does not build a FlightDeck-specific export UI beyond generating/revoking that access.
- The existing demo project (seeded in Module 1, DSN-issued in Module 2) is an acceptable target for
  this module's end-to-end testing; no separate project-creation flow is introduced.
- Log ingestion, live tail, and search apply to a single project's data at a time; this module does
  not attempt cross-project log aggregation or search.
