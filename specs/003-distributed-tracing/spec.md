# Feature Specification: Distributed Tracing

**Feature Branch**: `003-distributed-tracing`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Module 3 — Distributed tracing (span waterfalls, p50/p95 per
transaction, latency budgets, trace-to-error linkage)." (full brief in conversation history,
including protocol grounding researched against real Sentry developer docs, Cloudflare D1/Queues
research, and scope decisions already made — see plan.md's Technical Context and research.md for
the detailed technical record)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See where time actually goes in a request (Priority: P1)

A developer who already uses a Sentry SDK in their JavaScript/browser or Python application enables
tracing (the SDK's standard performance-monitoring option). Without changing any other code,
transactions their application produces start appearing in FlightDeck, each showing a visual
waterfall of the spans (database queries, HTTP calls, function timings) that made it up.

**Why this priority**: This is the entire value proposition of Module 3 — a developer can only
answer "why is this slow" once transactions and their spans reliably arrive and render. Nothing
else in this module matters if that pipeline doesn't work.

**Independent Test**: Configure a real `@sentry/browser`-family SDK and a real `sentry-sdk` (Python)
instance, both pointed at a FlightDeck project's DSN with tracing enabled, trigger a traced
operation from each, and confirm both appear as transactions in the dashboard, each openable into a
waterfall view showing its recorded spans in the correct nested order.

**Acceptance Scenarios**:

1. **Given** a project's DSN configured in a real Sentry SDK with tracing enabled, **When** the
   application completes a traced operation, **Then** a corresponding transaction appears in that
   project's Traces list within seconds, showing its name, operation type, and duration.
2. **Given** a transaction whose operation included several nested timed steps (e.g. an HTTP handler
   that made two database queries and one outbound HTTP call), **When** a developer opens that
   transaction, **Then** a waterfall view shows each span positioned and sized by its actual start
   time and duration, correctly nested under its parent step.
3. **Given** a request arrives at the ingest endpoint with a missing, unknown, or invalid DSN key,
   **When** the request is processed, **Then** it is rejected and no transaction is recorded.
4. **Given** a project is receiving an unusually high rate of trace data, **When** the rate limit is
   exceeded, **Then** further trace submissions for that project are rejected with a response the
   SDK recognizes as "back off," matching the same behavior already established for error ingest.

---

### User Story 2 - Spot which operations are actually slow (Priority: P2)

A developer opens the Traces list and sees every distinct operation the application performs (e.g.
"GET /checkout", "process_order"), each with its typical (p50) and worst-case-but-common (p95)
duration and how many times it's run recently — not just a raw list of individual transactions to
scroll through one at a time.

**Why this priority**: A list of individual transactions (User Story 1) proves the pipeline works,
but doesn't answer "which operation should I actually go fix" — that requires aggregating many
transactions of the same kind. Rated below User Story 1 because this view has nothing to aggregate
without transactions already arriving.

**Independent Test**: Ingest a batch of transactions sharing the same operation name with varying
durations, and confirm the Traces list shows that operation's p50 and p95 duration figures
consistent with the actual distribution ingested, alongside its transaction count.

**Acceptance Scenarios**:

1. **Given** multiple ingested transactions sharing the same operation name, **When** a developer
   views the Traces list, **Then** that operation appears once with its p50 duration, p95 duration,
   and count of transactions contributing to those figures.
2. **Given** an operation with only a single ingested transaction, **When** viewing the Traces list,
   **Then** its p50 and p95 both simply equal that one transaction's duration, not an error or
   placeholder state.
3. **Given** the Traces list, **When** a developer sorts or filters by duration, **Then** the
   slowest operations are easy to identify without manually comparing every row.

---

### User Story 3 - Jump from an error straight to what it happened during (Priority: P2)

A developer investigating an issue (Module 2) sees that the triggering event happened during an
active trace, and can jump straight to that trace's waterfall to see everything else that was going
on at the time — and, from the trace side, sees any errors that occurred during it.

**Why this priority**: This is the constitution's explicit "shared identifiers" promise made
concrete — genuinely useful once both errors (Module 2) and traces (User Story 1) exist
independently, but neither module is blocked on it, so it's correctly sequenced after both have
standalone value.

**Independent Test**: Ingest an error event and a transaction sharing the same trace identifier (as
a real SDK would produce when an error happens during a traced operation), and confirm each side's
detail view links to the other.

**Acceptance Scenarios**:

1. **Given** an issue whose triggering event was captured during an active trace, **When** a
   developer views that issue's detail, **Then** a reference to the originating trace is shown and
   leads to that trace's waterfall view.
2. **Given** a trace during which one or more errors occurred, **When** a developer views that
   trace's detail, **Then** the error(s) that happened during it are listed, leading to their
   respective issues.
3. **Given** an issue whose triggering event was captured with no active trace, **When** viewing
   that issue's detail, **Then** no trace reference is shown (not an error state — simply absent),
   matching the same "absent, not broken" pattern already established for Module 2's suspect-commit
   linkage.

### Edge Cases

- An ingest request's envelope is malformed (invalid JSON, truncated body, missing required
  headers): the request is rejected without crashing the ingest pipeline or affecting other
  projects' ingestion — the same guarantee already established for error ingest.
- A transaction has zero recorded spans (the traced operation did nothing worth timing internally):
  it still appears as a transaction with its own duration; the waterfall view shows just the root
  operation, not an error or empty state.
- The same transaction is submitted twice (e.g. a client retry after a network blip): it is not
  recorded as two separate transactions.
- A transaction's span data references a `parent_span_id` that isn't present among its own spans
  (e.g. a truncated span list from an SDK-side limit): the waterfall view renders what it has
  without failing to load the rest of the transaction.
- An ingest payload is excessively large (e.g. a transaction with an unusually large number of
  spans): it is rejected rather than accepted and allowed to degrade ingest performance for other
  projects.
- A transaction or its spans age past the retention window: they are fully removed (unlike Module
  2's issue/event split, a transaction is itself a summary row with no separate aggregate to
  preserve) — the Traces list and any percentile figures simply reflect only what remains.
- Trace data arrives referencing a `trace_id` that also appears on an already-ingested error (or
  vice versa, in either order): the linkage between them is shown correctly regardless of which
  side was ingested first.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept transaction (trace) data from an unmodified, standard
  browser/JavaScript Sentry SDK and an unmodified, standard Python Sentry SDK with tracing enabled,
  authenticated solely by the project's DSN — no FlightDeck-specific code changes required in the
  instrumented application.
- **FR-002**: The system MUST reject, without recording a transaction, any trace-ingest request
  whose DSN key is missing, unrecognized, or does not resolve to an active project.
- **FR-003**: The system MUST limit the rate of trace data accepted per project and, when that limit
  is exceeded, reject further submissions in a way the sending SDK recognizes as a rate-limit
  signal, consistent with the existing error-ingest rate limit behavior.
- **FR-004**: The system MUST present a Traces list per project, grouped by operation name, showing
  at minimum each operation's p50 duration, p95 duration, and recent transaction count.
- **FR-005**: The system MUST present a trace detail view showing a visual waterfall of a
  transaction's spans, each positioned and sized according to its actual timing and correctly
  nested by parent/child relationship.
- **FR-006**: The system MUST NOT record a second occurrence for a transaction the sending SDK has
  already successfully submitted (e.g. a retried request), so retries don't distort transaction
  counts or percentile figures.
- **FR-007**: The system MUST link an issue to the trace that was active when its triggering event
  was captured, when the SDK provided that association, and make that link navigable from the issue
  detail view.
- **FR-008**: The system MUST show, on a trace's detail view, any errors that occurred during that
  trace, when such errors exist.
- **FR-009**: The system MUST NOT show a trace link on an issue, or an error list on a trace, when
  no such association exists — absent, not an error state.
- **FR-010**: The system MUST reject trace-ingest payloads beyond a defined maximum size rather than
  accepting arbitrarily large payloads.
- **FR-011**: The system MUST automatically delete transaction and span data older than a bounded,
  documented default age, without requiring a person to trigger cleanup manually.
- **FR-012**: The system MUST continue to accept and display transactions with zero spans, and MUST
  render a waterfall view even when a transaction's span data is incomplete or partially
  inconsistent (e.g. a dangling parent reference), rather than failing to show the transaction at
  all.

### Key Entities *(include if feature involves data)*

- **Transaction**: one traced operation — name, operation type, start time, duration, the trace
  identifier it belongs to, and its full span tree.
- **Span**: one timed step within a transaction's span tree — operation type, description, start
  time, duration, and which other span (if any) it's nested under.
- **Trace**: the identifier shared by exactly one transaction and, optionally, one or more error
  events, that ties them together as having happened during the same logical operation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from enabling tracing in a standard Sentry SDK to seeing their
  first transaction's waterfall in FlightDeck in under 30 seconds.
- **SC-002**: A waterfall view accurately reflects the relative timing and nesting of every span in
  a transaction, verified by automated test against a transaction with a known, multi-level span
  structure.
- **SC-003**: 100% of trace-ingest requests with an invalid or unrecognized DSN are rejected with no
  data recorded, verified by automated test.
- **SC-004**: p50/p95 figures shown for an operation are correct for the actual set of transactions
  ingested for it, verified by automated test against a known distribution.
- **SC-005**: A developer viewing an issue whose event happened during a trace can reach that
  trace's waterfall in one click, and vice versa from the trace to the error.
- **SC-006**: Under sustained trace volume consistent with an early-stage product's real usage (not
  a load-test-scale burst), transaction ingestion shows no observable backlog and percentile figures
  stay accurate.

## Assumptions

- "Unmodified, standard Sentry SDK" carries the same meaning established in Module 2: the current
  stable major version of `@sentry/browser` (or `@sentry/react`) and `sentry-sdk` (Python), with
  tracing enabled via each SDK's standard `tracesSampleRate`/equivalent option — not every
  historical SDK version ever released.
- Percentile figures (p50/p95) are computed over a bounded recent time window (the exact window is
  an implementation default tuned during planning, not user-facing configuration in this module).
- Sampling decisions (which transactions an SDK actually sends) are entirely the SDK's own concern;
  FlightDeck stores and aggregates whatever trace data it receives without server-side re-sampling
  or a sampling-configuration UI — that remains out of scope for this module.
- The default trace/span retention window is a separate, likely shorter figure than Module 2's
  90-day event retention, given tracing's structurally higher data volume — the exact number is an
  implementation default tuned during planning, not user-facing configuration in this module.
- The existing demo project (seeded in Module 1, DSN-issued in Module 2) is an acceptable target for
  this module's end-to-end testing; no separate project-creation flow is introduced.
- Waterfall rendering and percentile aggregation apply to trace data as ingested; this module does
  not attempt to reconcile or merge traces spanning multiple distinct projects/DSNs.
