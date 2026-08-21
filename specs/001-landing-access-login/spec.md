# Feature Specification: Landing Site, Access Login & App-Shell Skeleton

**Feature Branch**: `001-landing-access-login`

**Created**: 2026-08-21

**Status**: Draft

**Input**: User description: "Module 1 — Landing site, Cloudflare Access login, and authenticated
app-shell skeleton." (public marketing site matching the FlightDeck design; a real Cloudflare
Access login flow replacing the design's simulated one; an authenticated app-shell skeleton with
empty states, no real telemetry data yet — see full brief in conversation history)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Evaluate FlightDeck as a prospective adopter (Priority: P1)

A visitor who has never heard of FlightDeck arrives on the public site (e.g. from a search result
or a shared link), reads what the product does, compares it against Sentry/GlitchTip, checks the
docs to see whether migration is realistic, and decides whether to try it — all without needing an
account.

**Why this priority**: This is the only part of Module 1 that creates value with zero dependencies
on anything else in the system (no auth, no backend data). It is also the literal front door: no
one reaches the login flow without passing through this experience first.

**Independent Test**: Load the site with no session and no credentials; navigate through Home,
Product, Docs, Self-hosting, and Changelog using only the top nav and footer; confirm every page
renders real content (not a mock/placeholder claiming to be a live feature) and no page requires
authentication.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor on the Home page, **When** they follow the top nav to
   Product, Docs, Self-hosting, or Changelog, **Then** the corresponding page renders without a
   full page reload and without ever prompting for login.
2. **Given** a visitor on the Docs page, **When** they click a left-nav section link, **Then** the
   page scrolls to that section's content, which includes the documented request/response shape as
   static reference material (not a live API call).
3. **Given** a visitor on any marketing page, **When** they click the "Log in" control, **Then**
   the sign-in modal from User Story 2 opens without navigating away from the page underneath.

---

### User Story 2 - Sign in via Cloudflare Access and reach the app (Priority: P1)

A member of an organization that has already configured Cloudflare Access for FlightDeck clicks
"Log in," is redirected through their organization's real identity provider (via Cloudflare
Access), and — once Access approves them — lands inside the authenticated application shell.

**Why this priority**: This is the specific capability this module exists to deliver: replacing
the design's simulated login timer with a real, working authentication flow. Without it, "login"
is a demo, not a feature.

**Independent Test**: With a Cloudflare Access application already configured for the deployed
environment, click "Log in" as a user included in the Access policy, complete the identity
provider's real challenge, and verify landing in the app shell with the correct identity displayed.
Separately, verify a user NOT included in the Access policy is blocked by Access itself before ever
reaching the application.

**Acceptance Scenarios**:

1. **Given** the sign-in modal is open, **When** the visitor clicks "Continue with Cloudflare
   Access," **Then** the browser is redirected into the real Cloudflare Access login flow for this
   application (not a simulated in-page timer).
2. **Given** Cloudflare Access has approved the user's identity, **When** the browser returns to
   FlightDeck, **Then** the application recognizes the authenticated session and displays the app
   shell instead of the marketing site.
3. **Given** a user's very first successful Access login ever recorded by FlightDeck, **When** the
   login completes, **Then** a corresponding user record is created automatically with no separate
   manual provisioning step.
4. **Given** a returning user whose browser still holds a valid Access session, **When** they load
   FlightDeck directly (no click-through from the marketing site), **Then** they land in the app
   shell without re-authenticating.
5. **Given** a request reaches FlightDeck's backend without a valid Access-issued credential (missing,
   expired, or otherwise invalid), **When** that request targets any authenticated capability,
   **Then** it is rejected and no authenticated data or page is served.

---

### User Story 3 - Navigate the app shell and sign out (Priority: P2)

An authenticated team member explores the app shell's navigation (Overview, Issues, Traces, Logs,
Releases, Uptime, Feedback, Alerts, Settings, Install SDK), sees accurate empty states since no
telemetry has been ingested yet, confirms their own identity in the user menu, and signs out when
done.

**Why this priority**: This makes the authenticated shell from User Story 2 actually navigable and
trustworthy — an empty state that's honest about having no data yet is what separates a real
skeleton from a broken-looking dead end. It's rated below User Story 2 because signing in
successfully is the harder, higher-risk capability; once that works, the shell itself is lower risk.

**Independent Test**: While authenticated, click through every sidebar destination and confirm each
renders a real, distinct empty state (not a shared generic error, not the design's mock data);
confirm the user menu shows the signed-in identity; click sign out and confirm return to the
unauthenticated marketing site.

**Acceptance Scenarios**:

1. **Given** an authenticated user in the app shell, **When** they select any sidebar destination
   (Overview, Issues, Traces, Logs, Releases, Uptime, Feedback, Alerts), **Then** that screen loads
   and clearly communicates there is no data yet, without displaying any of the design mockup's
   sample issues/traces/logs as if they were real.
2. **Given** an authenticated user in the app shell, **When** they open the user menu, **Then** it
   displays the email address associated with their Access identity.
3. **Given** an authenticated user in the app shell, **When** they click sign out, **Then** their
   local session ends, they are returned to the marketing site, and their next visit to an
   authenticated area prompts sign-in again rather than silently re-entering the app.
4. **Given** an authenticated user on the Settings screen, **When** the screen loads, **Then** it
   shows their own identity; no other member-management functionality is expected in this module.
5. **Given** an authenticated user on the Install SDK screen, **When** the screen loads, **Then** it
   shows static setup instructions/code snippets; no functioning ingest endpoint is expected to
   exist yet.

### Edge Cases

- A visitor who is not covered by the Cloudflare Access policy clicks "Continue with Cloudflare
  Access": Access itself denies them before any FlightDeck page loads; FlightDeck never receives an
  authenticated request for that person and shows no special in-app state for this case beyond
  whatever Access's own denial page shows.
- A previously valid session's Access credential expires while the user is idle inside the app
  shell: the next request that needs authentication is rejected, and the user is returned to a
  signed-out state rather than continuing to see stale authenticated content.
- A visitor deep-links directly to a marketing page (e.g. `/docs`) with no prior visit to `/`: the
  page renders correctly on its own, not only when reached via in-app navigation.
- A visitor deep-links directly to an app-shell URL (e.g. the Issues screen) with no active
  session: they are routed into the sign-in flow rather than shown a broken or blank authenticated
  screen.
- An already-authenticated user clicks "Log in" again (e.g. from a stale open tab): they are taken
  straight to the app shell rather than being shown the sign-in modal a second time.
- The browser's back/forward buttons are used while navigating client-routed marketing pages or
  app-shell screens: the correct corresponding view renders, matching what a full page reload at
  that URL would show.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST serve a public marketing site (Home, Product, Docs, Self-hosting,
  Changelog) reachable without authentication, matching the approved design's content and layout.
- **FR-002**: The system MUST route all marketing-site navigation client-side, without full page
  reloads, while still rendering each page correctly on a direct/deep-link visit.
- **FR-003**: The system MUST present a sign-in control from the marketing site's top nav that opens
  a sign-in modal describing that access is granted via the organization's Cloudflare Access policy.
- **FR-004**: The system MUST initiate a real Cloudflare Access authentication flow when the visitor
  chooses to continue signing in — no simulated or time-delayed fake authentication step.
- **FR-005**: The system MUST independently verify the Cloudflare Access identity assertion on every
  request to an authenticated capability, and MUST reject the request if that verification fails for
  any reason (missing, malformed, expired, or mismatched-audience/issuer credential).
- **FR-006**: The system MUST NOT gate the public marketing pages behind Cloudflare Access.
- **FR-007**: On a user's first successful authentication, the system MUST automatically create a
  corresponding user record without requiring a separate manual provisioning step.
- **FR-008**: On every successful authentication, the system MUST recognize a returning user and
  update their last-seen record.
- **FR-009**: The system MUST present an authenticated application shell — sidebar navigation
  grouped as Monitor (Overview, Issues, Traces, Logs), Ship (Releases, Uptime), Respond (Feedback,
  Alerts), plus Settings and Install SDK — once a session is authenticated.
- **FR-010**: Each app-shell navigation destination MUST render a real, distinct empty state
  communicating that no data exists yet, rather than the design's sample/mock data.
- **FR-011**: The app shell MUST display the signed-in user's identity (at minimum, their email)
  sourced from their verified Access credential, not from client-side-only state.
- **FR-012**: The system MUST provide a sign-out action that ends the local session such that a
  subsequent visit to an authenticated area requires signing in again.
- **FR-013**: The system MUST prevent an unauthenticated visitor from viewing any app-shell screen's
  content, routing them into the sign-in flow instead.
- **FR-014**: The system MUST NOT expose any of the future ingest, issues, traces, logs, releases,
  uptime, or feedback data-plane endpoints as functioning in this module — Install SDK and Docs
  content describing them is documentation only.

### Key Entities *(include if feature involves data)*

- **User**: A person who has authenticated via Cloudflare Access. Identified by the stable
  identifier from their Access credential (not their email, which can change); also carries email,
  identity-provider name, an application-level role, and first-seen/last-seen timestamps.
- **Project** *(seed/placeholder only in this module)*: The workspace the app shell's project
  switcher and navigation are scoped to. This module needs at least one such record to exist so the
  shell has something to display; issuing real projects/DSNs is out of scope here.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor can reach and read all five marketing pages (Home, Product, Docs,
  Self-hosting, Changelog) using only in-page navigation, with no page taking more than 2 seconds to
  become interactive on a typical broadband connection.
- **SC-002**: A user included in the organization's access policy can go from clicking "Log in" to
  seeing their own identity in the app shell in under 15 seconds of active interaction (excluding
  time spent on their identity provider's own challenge, e.g. entering an OTP).
- **SC-003**: 100% of requests to an authenticated capability that lack a valid Access credential are
  rejected — verified by automated tests, not manual spot-checking alone.
- **SC-004**: A user who is not covered by the Access policy cannot reach any authenticated screen's
  content under any navigation path, including direct URL entry.
- **SC-005**: Every one of the app shell's 8 navigation destinations (Overview, Issues, Traces,
  Logs, Releases, Uptime, Feedback, Alerts) plus Settings and Install SDK renders a distinct,
  accurate "no data yet" state with zero instances of the design mockup's sample data appearing as
  if real.
- **SC-006**: Signing out and immediately attempting to reload an authenticated screen requires
  signing in again 100% of the time.

## Assumptions

- A Cloudflare Access application for the deployed FlightDeck environment already exists (or will
  exist before this module reaches a real environment) with a policy naming the people who should be
  let in; this module consumes that configuration, it does not create the Access policy itself.
- "Sign out" ends FlightDeck's own recognition of the session; it is not expected to force-expire the
  underlying Cloudflare Access session at the identity-provider level, since Access owns that session
  lifecycle independently of the application behind it.
- The seed/placeholder project used to make the app shell's project switcher non-empty is
  synthetic/demo data, not a real customer workspace, and is understood to be superseded once real
  project creation ships in a later module.
- Changelog content for this module ships with at most one honest entry describing this module
  itself (e.g. an initial-release entry) rather than the design mockup's fabricated version history.
- "Typical broadband connection" and other environment-dependent performance assumptions in the
  Success Criteria follow standard web-application expectations; no dedicated performance testing
  infrastructure is assumed to exist yet.
