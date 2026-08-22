# Feature Specification: User Feedback

**Feature Branch**: `007-user-feedback`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Module 7 — User feedback (drop-in widget, crash-report dialog, linkage
to the originating event)." (full brief in conversation history, including protocol grounding
researched against real Sentry developer docs, and scope decisions already made — see plan.md's
Technical Context and research.md for the detailed technical record)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Collect feedback from anywhere in the app (Priority: P1)

A developer who already uses a Sentry SDK enables its feedback widget (the SDK's standard
integration option). Without changing any other code, their application's end users can submit
feedback — a message, optionally their name and contact info — from wherever they are in the app,
not just after something breaks.

**Why this priority**: This is the entire value proposition named first in this module's scope
("drop-in widget") — a developer wants their existing SDK to just work, the same promise every other
module has made for its own surface.

**Independent Test**: Configure a real `@sentry/browser`-family SDK with its feedback integration
enabled, pointed at a project's DSN, submit feedback through the resulting widget, and confirm it
appears in FlightDeck's Feedback list with its message and any provided contact info.

**Acceptance Scenarios**:

1. **Given** a project's DSN configured in a real Sentry SDK with feedback enabled, **When** an end
   user submits feedback through the widget, **Then** it appears in that project's Feedback list
   within seconds, showing the message and any name/contact info provided.
2. **Given** feedback submitted with no name or contact info (both optional), **When** viewing it,
   **Then** it displays correctly without those fields, not as an error or missing-data state.
3. **Given** feedback submitted while the end user was NOT viewing any specific error, **When**
   viewing it, **Then** it displays as standalone feedback with no linked issue — this is a normal,
   expected case, not an incomplete one.
4. **Given** a request arrives at the ingest endpoint with a missing, unknown, or invalid DSN key,
   **When** the request is processed, **Then** it is rejected and no feedback is recorded.

---

### User Story 2 - Ask what happened right after a crash (Priority: P1)

When an end user's application hits an unhandled error, the SDK's crash-report dialog appears asking
what happened. The end user's response is captured and linked to that specific error.

**Why this priority**: Equally core to this module's promise as User Story 1 ("crash-report dialog"
is named explicitly alongside the widget) — reactive, crash-triggered feedback is the highest-value
context a developer can get, since it's collected at the exact moment something went wrong.

**Independent Test**: Trigger a real error from an instrumented application configured to show the
crash-report dialog, submit feedback through it, and confirm the resulting feedback is linked to
that specific error's issue in FlightDeck's dashboard.

**Acceptance Scenarios**:

1. **Given** an application configured to show the crash-report dialog on error, **When** an
   unhandled error occurs, **Then** the dialog appears and functions correctly against FlightDeck,
   with no application-side configuration beyond what real SDK documentation describes.
2. **Given** feedback submitted through the crash-report dialog, **When** viewing the resulting
   feedback, **Then** it is linked to the specific error/issue it was submitted for.
3. **Given** an issue with linked feedback, **When** viewing that issue's detail, **Then** the
   linked feedback is visible from there too — the connection works in both directions.

---

### User Story 3 - Find the feedback tied to a specific issue (Priority: P2)

A developer investigating an issue sees any user feedback submitted about it, without needing to
separately search the Feedback list.

**Why this priority**: A natural extension of the linkage User Story 2 establishes, but the core
promise (feedback arrives and is linked at all) doesn't depend on this specific presentation — it's
a genuinely useful but secondary view of data that already exists.

**Independent Test**: From an issue with linked feedback, confirm that feedback is visible directly
from the issue's own detail view, not just from the general Feedback list.

**Acceptance Scenarios**:

1. **Given** an issue with one or more linked feedback submissions, **When** viewing that issue's
   detail, **Then** each linked submission's message (and contact info, if provided) is shown.
2. **Given** an issue with no linked feedback, **When** viewing its detail, **Then** no feedback
   section is shown — absent, not an empty/error state.

### Edge Cases

- An ingest request's envelope is malformed (invalid JSON, truncated body, missing required
  headers): the request is rejected without crashing the ingest pipeline or affecting other
  projects' ingestion — the same guarantee already established for every other ingest surface.
- Feedback references an error event that doesn't exist in this project (a mismatched or invalid
  linkage reference): the feedback is still recorded, simply without a working link, rather than
  being rejected outright.
- The same feedback submission is received twice (e.g. a client retry after a network blip): it is
  not recorded as two separate feedback entries.
- A crash-report dialog is invoked with no valid error reference available: it is handled gracefully
  by the flow the real SDK already defines for that case, not a FlightDeck-specific failure.
- An ingest payload is excessively large (e.g. an unusually long message): it is rejected rather
  than accepted and allowed to degrade ingest performance for other projects.
- Feedback includes fields this module doesn't act on (e.g. a screenshot/replay reference from a
  newer SDK version): those fields are accepted and ignored, not treated as an error — this module
  is not required to use every field a real submission might include.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST accept feedback submissions from an unmodified, standard
  browser/JavaScript Sentry SDK with its feedback widget enabled, authenticated solely by the
  project's DSN — no FlightDeck-specific code changes required in the instrumented application.
- **FR-002**: The system MUST reject, without recording any data, any feedback submission whose DSN
  key is missing, unrecognized, or does not resolve to an active project.
- **FR-003**: The system MUST accept feedback with only a message and no other fields — name and
  contact info are optional, not required.
- **FR-004**: The system MUST support an unmodified, standard SDK's crash-report dialog flow,
  including whatever request the SDK makes to load and display that dialog, without requiring
  application-side changes beyond what real SDK documentation describes.
- **FR-005**: The system MUST link feedback submitted through the crash-report dialog to the
  specific error it was submitted for, when the SDK provides that association.
- **FR-006**: The system MUST accept and correctly display feedback with no linked error as a
  normal, expected case — not an incomplete or erroneous one.
- **FR-007**: The system MUST present a feedback list per project, and a feedback detail view,
  showing the message, contact info (if provided), submission time, and any linked issue.
- **FR-008**: The system MUST show an issue's linked feedback from that issue's own detail view, and
  MUST NOT show a feedback section on an issue with none — absent, not an empty state.
- **FR-009**: The system MUST NOT record a second entry for a feedback submission the sending SDK
  has already successfully submitted (e.g. a retried request).
- **FR-010**: The system MUST reject feedback ingest payloads beyond a defined maximum size rather
  than accepting arbitrarily large submissions.

### Key Entities _(include if feature involves data)_

- **Feedback**: one end-user submission — message, optional name/contact info, submission time, the
  page URL it was submitted from (if provided), and the issue it's linked to (if any).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A developer can go from enabling a standard SDK's feedback widget to seeing submitted
  feedback in FlightDeck within seconds.
- **SC-002**: An unmodified SDK's crash-report dialog functions correctly against FlightDeck end to
  end (loads, displays, accepts submission), verified by testing against real SDK behavior, not just
  a hand-crafted approximation of it.
- **SC-003**: 100% of feedback-ingest requests with an invalid or unrecognized DSN are rejected with
  no data recorded, verified by automated test.
- **SC-004**: Feedback linked to an issue is visible from both the general Feedback list and that
  issue's own detail view, verified by automated test.
- **SC-005**: Standalone feedback (no linked issue) is stored and displayed correctly, verified by
  automated test — this is a normal case, not a degraded one.

## Assumptions

- "Unmodified, standard Sentry SDK" carries the same meaning established in prior modules: the
  current stable major version of `@sentry/browser` (or `@sentry/react`) with its feedback
  integration enabled — not every historical SDK version ever released.
- Screenshot/attachment support (a real capability of Sentry's actual feedback feature) is
  explicitly deferred, not part of this module's scope — feedback in this module is text plus
  optional contact info only.
- Session Replay integration (a real, related Sentry capability) is out of scope entirely —
  FlightDeck has no Session Replay feature on its roadmap at all; any replay-related field a real
  SDK submission includes is accepted and ignored, not treated as an error.
- This module ingests and displays feedback; it does not build a two-way reply/conversation workflow
  — a developer sees what was submitted, but this module has no mechanism for responding to the end
  user through FlightDeck.
- The existing demo project (seeded in Module 1, DSN-issued in Module 2) is an acceptable target for
  this module's end-to-end testing.
