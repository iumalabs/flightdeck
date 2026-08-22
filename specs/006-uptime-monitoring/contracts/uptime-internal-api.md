# Internal API Contract: Uptime Monitoring

All routes below are control-plane (constitution Principle I) and gated by the same `sessionAuth`
middleware Modules 1-5 established. This module introduces no ingest/DSN-authenticated surface at
all — it has no equivalent to Modules 2-5's public envelope endpoint.

## `GET /api/internal/checks`

Returns the current project's checks.

**Response `200`**:

```json
{
  "checks": [
    {
      "id": "string",
      "name": "string",
      "type": "http|tcp",
      "target": "string",
      "status": "up|down|unknown",
      "uptimePercent": 0
    }
  ]
}
```

## `POST /api/internal/checks`

Creates a check.

**Request**:
`{ "name": "string", "type": "http|tcp", "target": "string", "intervalSeconds": 60, "failureThreshold": 3, "recoveryThreshold": 2, "webhookUrl": "string?" }`.

**Behavior**: rejects `intervalSeconds < 60` (data-model.md); rejects creation past the 20-check
per-project cap (research.md §4) with a clear error, not a raw constraint violation. Writes
`audit_log` (constitution Principle X).

**Response `201`**: the created check's fields (as `GET /api/internal/checks/{id}`'s shape).
**Response `400`**: invalid interval or type. **Response `403`**: project's check cap reached.

## `GET /api/internal/checks/{id}`

Returns one check's full detail.

**Response `200`**:

```json
{
  "id": "string",
  "name": "string",
  "type": "http|tcp",
  "target": "string",
  "intervalSeconds": 0,
  "failureThreshold": 0,
  "recoveryThreshold": 0,
  "webhookUrl": "string|null",
  "status": "up|down|unknown",
  "uptimePercent": 0,
  "recentRuns": [
    {
      "trigger": "scheduled|interactive",
      "succeeded": true,
      "latencyMs": 0,
      "detail": "string|null",
      "runAt": "string"
    }
  ],
  "incidents": [{ "id": "string", "openedAt": "string", "resolvedAt": "string|null" }]
}
```

**Response `404`**: no check with that id in the caller's project.

## `PATCH /api/internal/checks/{id}` / `DELETE /api/internal/checks/{id}`

Edits or deletes a check. Deletion auto-resolves any open incident for it (data-model.md,
research.md §6) as part of the same operation. Both write `audit_log`.

**Response `200`** (PATCH, updated check) / **`200`** (DELETE, empty body).

## `POST /api/internal/checks/{id}/trigger`

Runs a check immediately, using the exact same evaluation `runCheck()` a scheduled run would use
(constitution Principle V, research.md §8) — `trigger: "interactive"`.

**Behavior**: synchronous — the response reflects the actual result of this specific run, not just
an acknowledgment that a run was queued.

**Response `200`**:

```json
{
  "succeeded": true,
  "latencyMs": 0,
  "detail": "string|null",
  "status": "up|down",
  "incidentOpened": false,
  "incidentResolved": false
}
```

`incidentOpened`/`incidentResolved` reflect whether THIS run's evaluation crossed a threshold — both
`false` on most runs (a single failure below threshold, or a run that doesn't change incident
state).

## `GET /api/internal/incidents`

Returns open and recently-resolved incidents across the project's checks.

**Response `200`**:

```json
{
  "incidents": [
    {
      "id": "string",
      "checkId": "string",
      "checkName": "string",
      "openedAt": "string",
      "resolvedAt": "string|null"
    }
  ]
}
```

## Non-goals for this contract

- No endpoint to configure the check-run retention window, the minimum interval, or the per-project
  check cap — all are implementation defaults (research.md §4-5), not user-facing configuration in
  this module.
- No endpoint to browse a check's full, unbounded run history — `recentRuns` is intentionally
  bounded (matching the retention window), not a general-purpose log browser.
