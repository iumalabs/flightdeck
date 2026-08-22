# Feature Specification: Uptime Monitoring

**Feature Branch**: `006-uptime-monitoring`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Module 6 — Uptime monitoring (HTTP/TCP checks, incident-aware
alerting, the first scheduled-handler consumer of constitution Principle V's shared
evaluation-logic rule)." (full brief in conversation history, including platform-capability
research into Cloudflare's actual execution-region controls, and scope decisions already made —
see plan.md's Technical Context and research.md for the detailed technical record)

**Note on this module's nature**: unlike Modules 2-5, this module has little Sentry protocol to be
compatible with — Sentry's own Uptime Monitoring product exists but its wire protocol isn't
publicly documented in a way this project can ground itself in. This module is substantially
FlightDeck-original, following general industry-standard uptime-monitoring conventions rather than
a specific external protocol.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know whether a service is reachable (Priority: P1)

A developer adds a check for a URL or host:port their service exposes. On a regular schedule,
FlightDeck verifies it's reachable and shows its current status.

**Why this priority**: This is the foundation everything else in this module depends on — incident
detection, alerting, and on-demand testing all require a working, scheduled check first.

**Independent Test**: Create a check against a known-reachable target and a known-unreachable
target, wait for a scheduled run, and confirm each shows the correct status (up/down).

**Acceptance Scenarios**:

1. **Given** a configured HTTP check, **When** its scheduled run executes and the target responds
   successfully, **Then** the check shows an "up" status.
2. **Given** a configured HTTP check, **When** its scheduled run executes and the target fails to
   respond successfully (non-success status, timeout, or connection failure), **Then** the check
   shows a "down" status.
3. **Given** a configured TCP check, **When** its scheduled run executes, **Then** it correctly
   reflects whether a raw connection to the target host/port succeeded.
4. **Given** a check's recent history, **When** viewing its detail, **Then** an uptime percentage
   over that recent window is shown.

---

### User Story 2 - Get notified once when something breaks, not once per failed check (Priority: P1)

When a check starts failing, a developer sees ONE incident open — not a new alert for every single
failed check while the outage continues. When the check recovers, the incident automatically
resolves.

**Why this priority**: Equally foundational as User Story 1 — a monitoring feature that either
never tells you something broke, or floods you with a duplicate alert on every single failed
check during one outage, isn't usable. This is the module's actual "incident-aware" promise, not
an enhancement on top of basic checking.

**Independent Test**: Configure a check with known consecutive-failure/recovery thresholds, make its
target fail repeatedly past the failure threshold, confirm exactly one incident opens; make it
succeed repeatedly past the recovery threshold, confirm the incident auto-resolves.

**Acceptance Scenarios**:

1. **Given** a check whose consecutive-failure threshold is reached, **When** the next check run
   also fails, **Then** exactly one incident opens — additional consecutive failures after that do
   NOT open additional incidents for the same outage.
2. **Given** an open incident, **When** consecutive successful check runs reach the recovery
   threshold, **Then** the incident automatically resolves.
3. **Given** a check with occasional, non-consecutive failures below the failure threshold, **When**
   viewing the check, **Then** no incident opens — isolated blips are not treated as outages.
4. **Given** open and resolved incidents across a project's checks, **When** viewing the Alerts
   view, **Then** all of them are listed, each linking back to its originating check.

---

### User Story 3 - Test a check right now, without waiting for its schedule (Priority: P2)

A developer who just configured a check (or is troubleshooting one) triggers it manually and sees
the result immediately, using the exact same evaluation the scheduled run would use.

**Why this priority**: Genuinely useful — confirming a newly-configured check actually works, or
checking current status without waiting for the next scheduled run — but the module's core value
(Users Stories 1-2) doesn't depend on it.

**Independent Test**: Trigger a check manually and confirm the result (and any resulting
status/incident change) matches what a scheduled run of the identical check would have produced.

**Acceptance Scenarios**:

1. **Given** a configured check, **When** a developer triggers it manually, **Then** the result
   appears immediately, using the same pass/fail evaluation a scheduled run would use.
2. **Given** a manual trigger that would cross a consecutive-failure or recovery threshold, **When**
   it runs, **Then** it affects incident state exactly as a scheduled run reaching that same
   threshold would.

---

### User Story 4 - Get notified outside the dashboard (Priority: P3)

A developer configures a webhook URL for a check. When an incident opens or resolves, FlightDeck
posts to it, so the developer can route the notification into their own tooling.

**Why this priority**: Valuable for teams who don't want to watch the dashboard directly, but the
Alerts view (User Story 2) is already a complete, no-configuration-needed notification surface —
this is an optional enhancement, not a requirement for the module's core promise.

**Independent Test**: Configure a webhook URL for a check, trigger an incident open and then a
resolution, confirm the webhook receives one request for each.

**Acceptance Scenarios**:

1. **Given** a check with a configured webhook URL, **When** an incident opens for it, **Then** a
   request is sent to that URL describing the incident.
2. **Given** a check with a configured webhook URL, **When** its open incident resolves, **Then** a
   request is sent to that URL describing the resolution.
3. **Given** a check with no webhook URL configured, **When** an incident opens or resolves,
   **Then** no request is attempted — this is optional, not a silent failure.

### Edge Cases

- A check's target is temporarily unreachable due to a network blip well below the consecutive-
  failure threshold: no incident opens, and the check's uptime percentage reflects the blip
  honestly without over-reacting to it.
- Two scheduled runs of the same check would overlap (a slow-responding target plus a short
  interval): the system does not let overlapping runs corrupt the check's consecutive-failure/
  recovery counting.
- A check is deleted while it has an open incident: the incident is not left dangling in an
  unreachable state — it's resolved or clearly marked as belonging to a deleted check, not silently
  orphaned.
- A webhook URL is unreachable or errors when FlightDeck tries to notify it: this does not prevent
  the incident itself from being correctly recorded and shown in the dashboard — webhook delivery
  failure is not allowed to corrupt or block the core incident-tracking state.
- A check is configured with an unreasonably short interval: the system enforces a sensible minimum
  rather than allowing a check to be configured in a way that would hammer an arbitrary third-party
  target.
- A manual "test now" trigger and a scheduled run for the same check happen to occur close together:
  both are valid runs and both correctly contribute to the check's consecutive-failure/recovery
  state — a manual trigger is not treated as somehow less real than a scheduled one.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow configuring an HTTP check (a target URL) or a TCP check (a
  target host and port) for a project, with a configurable check interval.
- **FR-002**: The system MUST enforce a minimum check interval, rather than allowing an arbitrarily
  frequent check against a third-party target.
- **FR-003**: The system MUST run each configured check on its schedule and record whether it
  succeeded or failed.
- **FR-004**: The system MUST show each check's current status and its uptime percentage over a
  recent window.
- **FR-005**: The system MUST use the exact same check-execution and evaluation logic whether a
  check run was triggered on schedule or manually — no divergent implementation between the two.
- **FR-006**: The system MUST allow triggering any configured check manually and show its result
  immediately.
- **FR-007**: The system MUST open exactly one incident when a check reaches a configurable
  consecutive-failure threshold, and MUST NOT open additional incidents for the same ongoing
  outage while it continues failing.
- **FR-008**: The system MUST automatically resolve an open incident when a check reaches a
  configurable consecutive-recovery threshold.
- **FR-009**: The system MUST present a view listing open and resolved incidents across a project's
  checks, each linking to its originating check.
- **FR-010**: The system MUST allow configuring an optional webhook URL per check, and MUST send a
  request to it when that check's incident opens and again when it resolves.
- **FR-011**: The system MUST NOT let a webhook delivery failure prevent or corrupt the underlying
  incident record.
- **FR-012**: The system MUST NOT leave an incident permanently open/dangling if its owning check is
  deleted.

### Key Entities *(include if feature involves data)*

- **Check**: a configured HTTP or TCP monitor — target, type, interval, alert thresholds, optional
  webhook URL, current status, recent run history.
- **Check Run**: one execution of a check (scheduled or manual) — outcome (success/failure),
  timestamp, latency, and whatever diagnostic detail (status code, error) is relevant to that
  outcome.
- **Incident**: a period during which a check was considered down — opened when the
  consecutive-failure threshold is reached, resolved when the consecutive-recovery threshold is
  reached, associated with the check it belongs to.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can configure a check and see its first real status within one scheduled
  interval, with no manual intervention required.
- **SC-002**: A sustained outage (many consecutive failures) produces exactly one incident, not one
  per failed check, verified by automated test.
- **SC-003**: An incident automatically resolves within one recovery-threshold's worth of successful
  checks after the underlying target recovers, verified by automated test.
- **SC-004**: A manually-triggered check produces a result identical in evaluation logic to what a
  scheduled run of the same check would produce, verified by automated test.
- **SC-005**: A configured webhook reliably receives exactly one notification per incident open and
  one per resolution, verified by automated test.

## Assumptions

- This module ships as a single-region check (Cloudflare's global network generally, not a
  developer-selectable or named set of geographic regions) — a deliberate, documented scope
  reduction from broader "multi-region" ambitions, driven by an actual platform constraint
  investigated during planning, not an oversight. True multi-region comparison is real, named
  future work, not part of this module.
- Alerting in this module's scope means: the in-dashboard Alerts view (always on, no configuration
  needed) and an optional per-check webhook. Email, Slack, PagerDuty/Opsgenie, and SMS notification
  delivery are all explicitly deferred to later work, not silently absent.
- This module monitors reachability (HTTP/TCP), not full synthetic browser-based monitoring
  (headless-browser page loads, visual regression, etc.) — that's a different, larger feature not
  named in this module's scope.
- No public-facing status page is part of this module — incident visibility is dashboard-only
  (plus the optional webhook), not a customer-facing communication surface.
- The existing demo project (seeded in Module 1) is an acceptable target for this module's
  end-to-end testing.
