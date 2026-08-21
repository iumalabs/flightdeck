# Internal API Contract Additions: Error Monitoring

All routes below are control-plane (constitution Principle I) and gated by the same `sessionAuth`
middleware Module 1 established — none are reachable via the DSN-authenticated ingest surface, and
the ingest surface is never reachable through these.

## `GET /api/internal/issues`

Returns the current project's issues, most-recently-active first.

**Response `200`**:
```json
{
  "issues": [
    { "id": "string", "title": "string", "culprit": "string|null", "level": "string",
      "eventCount": 0, "firstSeen": "string", "lastSeen": "string" }
  ]
}
```

## `GET /api/internal/issues/{id}`

Returns full detail for one issue, including its most recent event's resolved stack trace,
breadcrumbs, tags/context, and (if a repository is connected and a suspect commit resolves) the
suspect commit.

**Response `200`**:
```json
{
  "id": "string", "title": "string", "culprit": "string|null", "level": "string",
  "eventCount": 0, "firstSeen": "string", "lastSeen": "string",
  "latestEvent": {
    "stacktrace": { "frames": [ { "filename": "string", "function": "string", "lineno": 0, "colno": 0, "resolved": true } ] },
    "breadcrumbs": [ { "timestamp": "string", "category": "string|null", "message": "string|null", "level": "string" } ],
    "tags": {}, "contexts": {}
  },
  "suspectCommit": { "sha": "string", "message": "string", "author": "string", "url": "string" } | null
}
```

**Response `404`**: no issue with that id in the caller's project.

## `POST /api/internal/projects/{id}/source-maps`

Uploads a source map for a release. FlightDeck's own minimal shape — deliberately not sentry-cli's
real endpoint (research.md §7).

**Request**: `multipart/form-data` — fields: `release` (string), `minifiedPathPattern` (string),
`file` (the source map content).

**Behavior**: creates the `release` row if it doesn't exist yet (spec's Edge Cases); stores the file
in R2 (research.md §7); writes the `source_maps` metadata row; writes an `audit_log` entry
(constitution Principle X, plan.md's Constitution Check).

**Response `201`**: `{ "id": "string" }`. **Response `413`**: file exceeds the configured maximum
size.

## `POST /api/internal/projects/{id}/github/connect`

Begins connecting a GitHub repository — the actual authorization happens via GitHub's own App
installation flow (research.md §10); this endpoint records the result.

**Request**: `{ "installationId": "string", "owner": "string", "repo": "string" }` (values supplied
by the GitHub App installation callback, not typed in by the user).

**Behavior**: upserts the project's single `repository_connections` row (spec FR-009: exactly one
per project); writes an `audit_log` entry.

**Response `200`**: `{ "owner": "string", "repo": "string" }`.

## `DELETE /api/internal/projects/{id}/github`

Disconnects the project's repository connection.

**Behavior**: deletes the `repository_connections` row; writes an `audit_log` entry. Idempotent —
deleting when nothing is connected is a `200`, not a `404`.

**Response `200`**: empty body.

## Non-goals for this contract

- No endpoint to browse/select which repository to connect from within FlightDeck's own UI beyond
  what the GitHub App's own installation flow already provides — this module doesn't build a GitHub
  repo picker, it records the installation flow's result.
- No issue resolve/ignore/assign endpoints — not required by any FR in spec.md.
