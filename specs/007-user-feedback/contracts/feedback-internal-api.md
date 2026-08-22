# Internal API Contract: User Feedback

All routes below are control-plane (constitution Principle I) and gated by the same `sessionAuth`
middleware Modules 1-6 established.

## `GET /api/internal/feedback`

Returns the current project's feedback, newest first.

**Response `200`**:

```json
{
  "feedback": [
    {
      "id": "string",
      "message": "string",
      "name": "string|null",
      "contactEmail": "string|null",
      "source": "widget|crash_report_dialog",
      "issueId": "string|null",
      "receivedAt": "string"
    }
  ]
}
```

## `GET /api/internal/feedback/{id}`

Returns one feedback submission's full detail.

**Response `200`**:

```json
{
  "id": "string", "message": "string", "name": "string|null", "contactEmail": "string|null",
  "url": "string|null", "source": "widget|crash_report_dialog", "receivedAt": "string",
  "issue": { "id": "string", "title": "string" } | null
}
```

**Response `404`**: no feedback with that id in the caller's project.

## `IssueDetailScreen` addition (not a new route)

`GET /api/internal/issues/{id}` (existing, Module 2) gains a `feedback` array field — non-empty only
when at least one `Feedback` row has `issue_id` matching this issue (FR-008):

```json
{
  "...": "existing issue-detail fields",
  "feedback": [
    {
      "id": "string",
      "message": "string",
      "name": "string|null",
      "contactEmail": "string|null",
      "receivedAt": "string"
    }
  ]
}
```

An empty array renders as no feedback section at all (spec Acceptance Scenario, User Story 3) — the
frontend, not the API, decides not to render the section; the API always returns the array (possibly
empty), consistent with how other optional related-data arrays on this endpoint already behave.
