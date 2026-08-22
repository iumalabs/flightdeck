# Internal API Contract Additions: Releases

All routes below are control-plane (constitution Principle I) and gated by the same `sessionAuth`
middleware Modules 1-4 established — none are reachable via the API-token-authenticated
release-management surface (contracts/release-management-api.md), and that surface is never
reachable through these.

## `GET /api/internal/releases`

Returns the current project's releases, most-recently-created first.

**Response `200`**:
```json
{
  "releases": [
    { "id": "string", "version": "string", "dateReleased": "string|null",
      "adoptionPercent": 0, "crashFreeSessionRate": 0, "crashFreeUserRate": 0,
      "deployCount": 0 }
  ]
}
```

`adoptionPercent`/`crashFreeSessionRate`/`crashFreeUserRate` are `null` (not `0`), and the dashboard
shows an honest "no data yet" state, when `release_health` has no rows for that release yet (spec
FR-006, Acceptance Scenario 2) — a real absence of data must never render as a misleadingly precise
number.

## `GET /api/internal/releases/{id}`

Returns one release's full detail.

**Response `200`**:
```json
{
  "id": "string", "version": "string", "dateReleased": "string|null",
  "environments": [
    { "environment": "string", "adoptionPercent": 0, "crashFreeSessionRate": 0,
      "crashFreeUserRate": 0 }
  ],
  "commits": [ { "sha": "string", "message": "string", "author": "string" } ],
  "deploys": [ { "environment": "string", "deployedAt": "string" } ],
  "regressedIssues": [ { "issueId": "string", "title": "string" } ]
}
```

`regressedIssues` lists issues whose `resolved_release_id` references THIS release and whose
current `status` is `unresolved` (data-model.md's inferred-regression state). `environments` is
`[]`, not omitted, when no health data exists for any environment yet.

**Response `404`**: no release with that id in the caller's project.

## `POST /api/internal/issues/{id}/resolve`

Resolves an issue (extends Module 2's existing issue-detail contract).

**Request**: `{ "mode": "exact" | "next-release", "releaseId": "string?" }` — `releaseId` required
for `"exact"` mode (defaults to the issue's most-recently-seen event's release if omitted and
determinable); ignored for `"next-release"` mode (the resolution-time latest release is recorded
automatically).

**Behavior**: sets `status = 'resolved'`, `resolved_release_id`, `resolved_mode`. Writes `audit_log`
(constitution Principle X).

**Response `200`**: `{ "status": "resolved", "resolvedReleaseId": "string", "resolvedMode": "string" }`.

## `POST /api/internal/projects/{id}/api-tokens`

Generates a new API token for the project (research.md §4).

**Behavior**: creates the `api_tokens` row (hashed), writes `audit_log`.

**Response `201`**: `{ "id": "string", "token": "string" }` — `token` is the raw value, returned
ONCE; it is never retrievable again (data-model.md's Validation rules).

## `DELETE /api/internal/projects/{id}/api-tokens/{tokenId}`

Revokes an API token.

**Behavior**: sets `revoked_at`; writes `audit_log`. Idempotent — revoking an already-revoked token
is a `200`, not a `404` (matching Module 2's GitHub-disconnect precedent).

**Response `200`**: empty body.

## Non-goals for this contract

- No endpoint to retrieve a previously-generated token's raw value — by design, matching standard
  API-credential handling (data-model.md).
- No `ignore`/`snooze`/assign endpoints on issues — only the bare resolve action (spec.md's
  Assumptions).
