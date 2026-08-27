import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState.tsx";

interface FeedbackListItem {
  id: string;
  message: string;
  name: string | null;
  contactEmail: string | null;
  source: string;
  issueId: string | null;
  receivedAt: string;
}

interface FeedbackDetail {
  id: string;
  message: string;
  name: string | null;
  contactEmail: string | null;
  url: string | null;
  source: string;
  receivedAt: string;
  issue: { id: string; title: string } | null;
}

const SOURCE_LABEL: Record<string, string> = {
  widget: "Widget",
  crash_report_dialog: "Crash dialog",
};

function FeedbackDetailView(
  { id, projectId, onBack, onSelectIssue }: {
    id: string;
    projectId: string | null;
    onBack: () => void;
    onSelectIssue: (id: string) => void;
  },
) {
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = projectId ? `?project=${projectId}` : "";
    fetch(`/api/internal/v1/feedback/${id}${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<FeedbackDetail> : null))
      .then((data) => {
        if (!cancelled) setFeedback(data);
      })
      .catch(() => {
        if (!cancelled) setFeedback(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, projectId]);

  if (loading) return null;

  if (!feedback) {
    return (
      <div>
        <span
          onClick={onBack}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onBack();
            }
          }}
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}
        >
          ← Back to Feedback
        </span>
        <p style={{ color: "var(--fg2)", marginTop: 16 }}>Feedback not found.</p>
      </div>
    );
  }

  const linkedIssue = feedback.issue;

  return (
    <div>
      <span
        onClick={onBack}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onBack();
          }
        }}
        role="button"
        tabIndex={0}
        style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}
      >
        ← Back to Feedback
      </span>
      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--panel)",
          maxWidth: 560,
          padding: 18,
          marginTop: 16,
        }}
      >
        <p style={{ fontSize: 14, marginTop: 0, marginBottom: 14 }}>{feedback.message}</p>
        <div style={{ fontSize: 12.5, color: "var(--fg2)", marginBottom: 4 }}>
          {feedback.name ?? "Anonymous"}
          {feedback.contactEmail ? ` · ${feedback.contactEmail}` : ""}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg3)" }}>
          {SOURCE_LABEL[feedback.source] ?? feedback.source} · {feedback.receivedAt}
          {feedback.url ? ` · ${feedback.url}` : ""}
        </div>
        {linkedIssue && (
          <div style={{ marginTop: 12, fontSize: 12.5 }}>
            Linked issue:{" "}
            <span
              onClick={() => onSelectIssue(linkedIssue.id)}
              style={{ color: "var(--accent)", cursor: "pointer" }}
            >
              {linkedIssue.title}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export interface FeedbackScreenProps {
  projectId: string | null;
  // issue #109 — selection now lives in AppShell (matching issues/traces/releases/uptime) so it's
  // reflected in the URL (/web-app/feedback/{id}) instead of being purely local React state that
  // vanished on reload and didn't participate in browser back/forward.
  selectedFeedbackId: string | null;
  onSelectFeedback: (id: string) => void;
  onBackToFeedback: () => void;
  onSelectIssue: (id: string) => void;
}

export function FeedbackScreen(
  { projectId, selectedFeedbackId, onSelectFeedback, onBackToFeedback, onSelectIssue }:
    FeedbackScreenProps,
) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<FeedbackListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = projectId ? `?project=${projectId}` : "";
    fetch(`/api/internal/v1/feedback${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ feedback: FeedbackListItem[] }> : null))
      .then((data) => {
        if (!cancelled) setItems(data?.feedback ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (selectedFeedbackId) {
    return (
      <FeedbackDetailView
        id={selectedFeedbackId}
        projectId={projectId}
        onBack={onBackToFeedback}
        onSelectIssue={onSelectIssue}
      />
    );
  }

  return (
    <div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          fontWeight: 600,
          margin: "0 0 20px",
        }}
      >
        Feedback
      </h1>

      {loading
        ? null
        : items && items.length > 0
        ? (
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => onSelectFeedback(item.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectFeedback(item.id);
                  }
                }}
                role="button"
                tabIndex={0}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--line2)",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    // Floor the message column so it ellipsizes instead of collapsing to 0px
                    // once the fixed-width columns to its right (plus the now flex:none
                    // timestamp) consume the rest of a narrow row (#103). Kept modest (rather than
                    // e.g. 120px) because at the issue's 616px repro width the source/status
                    // columns are already squeezed to their own single-word floors — a larger
                    // message floor would just push the row's total width past its container and
                    // get silently clipped by the content pane's overflowX: hidden instead.
                    minWidth: 100,
                    fontSize: 13.5,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.message}
                </span>
                <span style={{ width: 110, fontSize: 12, color: "var(--fg3)" }}>
                  {SOURCE_LABEL[item.source] ?? item.source}
                </span>
                <span style={{ width: 90, fontSize: 12, color: "var(--fg3)" }}>
                  {item.issueId ? "linked" : "standalone"}
                </span>
                <span
                  style={{
                    // Fixed, non-shrinking footprint (sized to comfortably fit the
                    // "YYYY-MM-DD HH:MM:SS" format `receivedAt` renders in, ~96px observed) so
                    // this column no longer eats into the message column's remaining space
                    // unpredictably (#103).
                    flex: "none",
                    width: 104,
                    whiteSpace: "nowrap",
                    color: "var(--fg3)",
                    fontSize: 12,
                  }}
                >
                  {item.receivedAt}
                </span>
              </div>
            ))}
          </div>
        )
        : (
          <EmptyState
            title="No feedback yet"
            body="Drop the feedback widget into your app and user messages will land here, linked to the event that triggered them."
          />
        )}
    </div>
  );
}
