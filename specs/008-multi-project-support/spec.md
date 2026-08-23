# Feature Specification: Multi-Project Support

**Feature Branch**: `008-multi-project-support`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: "Multi-project support — a project-creation endpoint plus dashboard-wide
project scoping/filtering, built now specifically to unblock connecting a second real application
(typestreak.app) to FlightDeck for monitoring, alongside the existing 'demo' project." (full brief
in conversation history — the exact scoping mechanism for dashboard routes is explicitly left open
for the planning phase, not decided here)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a new project to onboard a real application (Priority: P1)

A workspace member creates a new project so a second, real application can start sending telemetry
to FlightDeck without mixing into the existing "demo" project's data.

**Why this priority**: Nothing else in this feature matters without a way to actually create a
second project — this is the entry point for the whole feature and the immediate, concrete need
(onboarding typestreak.app).

**Independent Test**: Create a new project by name, confirm it appears in the project list with its
own DSN distinct from every other project's, and confirm a test event submitted with that DSN is
attributed to the new project (not "demo").

**Acceptance Scenarios**:

1. **Given** a signed-in workspace member, **When** they create a project with a name, **Then** a
   new project is created with its own unique DSN, and the action is recorded in the audit log.
2. **Given** two existing projects, **When** an event is submitted using the second project's DSN,
   **Then** it is attributed only to that project, never to the first.
3. **Given** an attempt to create a project with no name, **When** the creation is submitted,
   **Then** it is rejected and no project is created.

---

### User Story 2 - Switch which project the dashboard is showing (Priority: P1)

A workspace member switches between projects from the dashboard and sees only that project's data —
issues, traces, logs, releases, uptime checks, feedback — never another project's data mixed in.

**Why this priority**: Equally foundational as User Story 1 — creating a second project has no
practical value if the dashboard still only ever shows (or indiscriminately mixes) data across all
projects. This is the other half of "usably connect a second application."

**Independent Test**: With two projects each holding distinct data (e.g. distinctly-titled issues),
switch between them in the dashboard and confirm each screen shows only the selected project's data.

**Acceptance Scenarios**:

1. **Given** two projects with distinct data, **When** the member selects one from the project
   switcher, **Then** every dashboard screen (issues, traces, logs, releases, uptime, feedback)
   shows only that project's data.
2. **Given** a project switch, **When** the member navigates to a different dashboard screen,
   **Then** the same, previously-selected project stays selected — it does not silently reset.
3. **Given** a workspace with only one project (the common case today), **When** the dashboard
   loads, **Then** it behaves exactly as it does today — no extra step is imposed on a
   single-project workspace.

---

### User Story 3 - Create a project and immediately install an SDK against it (Priority: P2)

A workspace member creates a project and is shown its DSN and standard SDK install instructions
right away, so they can hand it to a real application's development team without hunting for it
separately.

**Why this priority**: A natural, low-effort extension of User Story 1 that makes the "connect a
real application" workflow materially faster, but the core capability (a working second project)
already exists without it.

**Independent Test**: Create a project and confirm its DSN and install instructions are visible
immediately, without a separate navigation step.

**Acceptance Scenarios**:

1. **Given** a newly-created project, **When** the creation completes, **Then** its DSN is shown
   immediately (not only after navigating elsewhere to find it).

### Edge Cases

- A project is created with a name identical to an existing project's: both are allowed to coexist
  (name is a display label, not a uniqueness key — the DSN is what's actually unique).
- The dashboard's selected project is deleted or otherwise becomes invalid (out of scope for this
  feature to build deletion, but the selection mechanism must not crash if it ever points at a
  project the workspace no longer has access to) — falls back to the first available project.
- A workspace member switches projects while a long-running view (e.g. live log tail) is open: the
  view stops reflecting the old project and reflects the new selection, not a mix of both.
- An ingest request's DSN resolves to a project that isn't the currently-selected dashboard
  project: ingest is entirely unaffected by dashboard selection — ingest has always resolved
  project by DSN key alone, and this feature does not change that.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a signed-in workspace member to create a new project by
  providing a name.
- **FR-002**: The system MUST reject project creation with no name provided.
- **FR-003**: The system MUST generate a unique DSN for every newly-created project, using the same
  DSN format already used by every existing project.
- **FR-004**: The system MUST record project creation in the audit log (actor, action, timestamp).
- **FR-005**: The system MUST let a workspace member select which project the dashboard is
  currently showing, when more than one project exists.
- **FR-006**: Every dashboard screen showing project-scoped data (issues, traces, logs, releases,
  uptime checks, feedback, settings) MUST reflect only the currently-selected project's data.
- **FR-007**: The system MUST persist the selected project across navigation within a session (not
  reset to a default on every screen change).
- **FR-008**: The system MUST NOT change ingest-side behavior — a submitted event's project
  attribution continues to be resolved solely from its DSN key, unaffected by dashboard selection.
- **FR-009**: A workspace with exactly one project MUST continue to behave as it does today, with no
  additional step required to see that project's data.
- **FR-010**: The system MUST show a newly-created project's DSN at creation time, without a
  separate navigation step to find it.

### Key Entities *(include if feature involves data)*

- **Project**: already exists (name, DSN public key) — this feature adds the ability to create new
  rows of this existing entity through the dashboard, and to select one as the dashboard's active
  scope. No new entity is introduced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A workspace member can create a new project and see its DSN in under 30 seconds,
  without leaving the dashboard.
- **SC-002**: 100% of dashboard screens showing project-scoped data show only the selected
  project's data when two or more projects exist, verified by automated test.
- **SC-003**: A single-project workspace's experience is unchanged — verified by automated test that
  the existing single-project flows still work with no new required step.
- **SC-004**: Ingest attribution is unaffected by dashboard project selection — verified by
  automated test that submitting to two different projects' DSNs never cross-attributes.

## Assumptions

- "Workspace member" means any signed-in FlightDeck user (constitution's existing `users`/session
  model) — this feature does not introduce per-project membership or role restrictions; anyone who
  can reach the dashboard today can create a project and switch between all projects. Per-project
  membership scoping is a real, separate concern, explicitly deferred (not silently dropped).
- Project deletion, renaming, and DSN rotation/revocation are explicitly out of scope for this
  feature — named as deferred future work, not silently absent.
- The exact mechanism by which a dashboard request communicates "which project" (a URL path segment,
  query parameter, or header) is an implementation decision left to the planning phase, not
  specified here — this spec only requires that the outcome (screens reflect the selected project)
  holds.
- The existing "demo" project continues to exist unchanged after this feature ships; it is not
  special-cased beyond being the default when only one project exists.
