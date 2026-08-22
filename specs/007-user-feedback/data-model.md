# Phase 1 Data Model: User Feedback

## Feedback

| Field                 | Type                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | TEXT, PRIMARY KEY                         |                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `project_id`          | TEXT, NOT NULL, REFERENCES projects(id)   |                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `message`             | TEXT, NOT NULL                            | Widget path: `contexts.feedback.message`. Dialog path: the `comments` form field (research.md §1) — both map to this one column.                                                                                                                                                                                                                                                                                           |
| `name`                | TEXT, NULLABLE                            |                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `contact_email`       | TEXT, NULLABLE                            | Widget path: `contexts.feedback.contact_email`. Dialog path: the `email` form field.                                                                                                                                                                                                                                                                                                                                       |
| `url`                 | TEXT, NULLABLE                            | Referring page (widget path only — the dialog has no equivalent field, research.md §1).                                                                                                                                                                                                                                                                                                                                    |
| `associated_event_id` | TEXT, NULLABLE                            | The SDK's own `event_id` reference (widget: `contexts.feedback.associated_event_id`; dialog: the `eventId` query param) — never a FlightDeck-generated FK.                                                                                                                                                                                                                                                                 |
| `issue_id`            | TEXT, NULLABLE, REFERENCES issues(id)     | Denormalized at write time by resolving `associated_event_id` against `events.sdk_event_id` (research.md §3) — avoids a join through `events` for the common "show this issue's feedback" read path. NULL when `associated_event_id` is absent or doesn't resolve (spec Edge Case — feedback is still recorded standalone, per FR-006).                                                                                    |
| `sdk_event_id`        | TEXT, NULLABLE                            | The feedback item's OWN `event_id` (distinct from `associated_event_id`, which references a DIFFERENT, already-ingested error event) — used for dedup (research.md §4). NULL is possible for the dialog path, which has no envelope item and thus no SDK-assigned feedback event_id of its own; dedup for that path instead relies on the `(project_id, associated_event_id)` upsert behavior confirmed in research.md §1. |
| `source`              | TEXT, NOT NULL                            | `'widget'` or `'crash_report_dialog'` — which of this module's two ingest paths produced the row; not part of the real Sentry protocol, a FlightDeck-only column for UI display/filtering.                                                                                                                                                                                                                                 |
| `received_at`         | TEXT, NOT NULL, DEFAULT `datetime('now')` |                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Validation rules**: `message` is required and MUST NOT exceed the shared ingest payload size limit
(FR-010, matching Module 2's `MAX_ENVELOPE_BYTES` posture — enforced at the envelope/request layer,
not a DB-level length constraint). `name`/`contact_email`/`url` are optional (FR-003). A
`source =
'crash_report_dialog'` row is upserted (research.md §1's confirmed `IntegrityError` →
overwrite behavior) on a unique `(project_id, associated_event_id, source)` constraint scoped to the
dialog path only — the widget path's dedup key is `(project_id, sdk_event_id)` instead, since widget
submissions are not inherently tied to one `associated_event_id` (spec Acceptance Scenario 3:
standalone feedback has none).

**Indexes**: `(project_id, received_at)` — powers the project feedback list. `(issue_id)` — powers
the issue-detail cross-link (FR-008), partial/sparse in practice since most rows may have a NULL
`issue_id`.

**State transitions**: none — a `Feedback` row is write-once (the dialog path's upsert overwrites in
place on a genuine retry, but this is dedup, not a modeled state transition; this module has no
resolve/reply/status concept, per spec.md's Assumptions).

## Relationship to existing entities (Module 2)

- `Feedback.project_id` → `projects.id` (existing).
- `Feedback.issue_id` → `issues.id` (existing) — resolved at write time, nullable.
- `Feedback.associated_event_id` is compared against `events.sdk_event_id` (existing column) at
  write time to derive `issue_id`; no live FK is kept to `events` itself (an `events` row could in
  principle be pruned by future retention work without needing to cascade into `Feedback`, since
  `issue_id` — not `associated_event_id` — is what the UI actually reads from).
