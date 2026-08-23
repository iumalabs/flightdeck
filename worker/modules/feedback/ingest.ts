// Shared write path for both feedback ingest surfaces (specs/007-user-feedback) — the widget's
// envelope item and the crash-report dialog's form POST converge here, so the
// associated_event_id -> issue_id resolution (research.md §3) is written once, not duplicated.

export interface WidgetFeedbackInput {
  message: string;
  name: string | null;
  contactEmail: string | null;
  url: string | null;
  associatedEventId: string | null;
  sdkEventId: string | null;
}

export interface DialogFeedbackInput {
  message: string;
  name: string | null;
  contactEmail: string | null;
  associatedEventId: string;
}

// events.sdk_event_id (Module 2) is the SDK's own event_id — both the widget's
// associated_event_id and the dialog's eventId query param resolve against this same column,
// scoped by project (research.md §3). Null when absent or unresolved — feedback is still recorded
// standalone (spec FR-006), never rejected for a dangling reference.
export async function resolveIssueId(
  db: D1Database,
  projectId: string,
  associatedEventId: string | null,
): Promise<string | null> {
  if (!associatedEventId) return null;
  const row = await db
    .prepare(`SELECT issue_id FROM events WHERE project_id = ?1 AND sdk_event_id = ?2`)
    .bind(projectId, associatedEventId)
    .first<{ issue_id: string }>();
  return row?.issue_id ?? null;
}

// Widget path — dedup by the feedback item's OWN event_id (research.md §4, mirroring Module 2's
// existing event dedup pattern exactly), distinct from associated_event_id (a DIFFERENT,
// already-ingested error event this feedback merely references).
export async function insertWidgetFeedback(
  db: D1Database,
  projectId: string,
  input: WidgetFeedbackInput,
): Promise<void> {
  if (input.sdkEventId) {
    const existing = await db
      .prepare(`SELECT 1 FROM feedback WHERE project_id = ?1 AND sdk_event_id = ?2`)
      .bind(projectId, input.sdkEventId)
      .first();
    if (existing) return;
  }

  const issueId = await resolveIssueId(db, projectId, input.associatedEventId);
  await db
    .prepare(
      `INSERT INTO feedback
         (id, project_id, message, name, contact_email, url, associated_event_id, issue_id, sdk_event_id, source)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'widget')`,
    )
    .bind(
      crypto.randomUUID(),
      projectId,
      input.message,
      input.name,
      input.contactEmail,
      input.url,
      input.associatedEventId,
      issueId,
      input.sdkEventId,
    )
    .run();
}

// Dialog path — upserts on (project_id, associated_event_id, source='crash_report_dialog')
// (0007_user_feedback.sql's partial unique index, research.md §1's confirmed real-Sentry
// IntegrityError-becomes-overwrite behavior) — a retried submission overwrites in place, not a
// second row.
export async function upsertDialogFeedback(
  db: D1Database,
  projectId: string,
  input: DialogFeedbackInput,
): Promise<void> {
  const issueId = await resolveIssueId(db, projectId, input.associatedEventId);
  await db
    .prepare(
      `INSERT INTO feedback
         (id, project_id, message, name, contact_email, associated_event_id, issue_id, source)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'crash_report_dialog')
       ON CONFLICT (project_id, associated_event_id) WHERE source = 'crash_report_dialog'
       DO UPDATE SET
         message = excluded.message,
         name = excluded.name,
         contact_email = excluded.contact_email,
         issue_id = excluded.issue_id,
         received_at = datetime('now')`,
    )
    .bind(
      crypto.randomUUID(),
      projectId,
      input.message,
      input.name,
      input.contactEmail,
      input.associatedEventId,
      issueId,
    )
    .run();
}
