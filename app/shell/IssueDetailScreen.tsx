import { useEffect, useState } from "react";

interface StackFrame {
  filename?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  resolved?: boolean;
}

interface Breadcrumb {
  timestamp?: string | number;
  category?: string | null;
  message?: string | null;
  level?: string;
}

interface SuspectCommit {
  sha: string;
  message: string;
  author: string;
  url: string;
}

interface IssueDetail {
  id: string;
  title: string;
  culprit: string | null;
  level: string;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
  latestEvent: {
    stacktrace: { frames?: StackFrame[] } | null;
    breadcrumbs: Breadcrumb[];
    tags: Record<string, string>;
    contexts: Record<string, unknown>;
  } | null;
  suspectCommit: SuspectCommit | null;
}

export interface IssueDetailScreenProps {
  issueId: string;
  onBack: () => void;
}

export function IssueDetailScreen({ issueId, onBack }: IssueDetailScreenProps) {
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<IssueDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/internal/issues/${issueId}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<IssueDetail> : null))
      .then((data) => {
        if (!cancelled) setIssue(data);
      })
      .catch(() => {
        if (!cancelled) setIssue(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  if (loading) return null;

  if (!issue) {
    return (
      <div>
        <span onClick={onBack} style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}>
          ← Back to Issues
        </span>
        <p style={{ color: "var(--fg2)", marginTop: 16 }}>Issue not found.</p>
      </div>
    );
  }

  const frames = issue.latestEvent?.stacktrace?.frames ?? [];

  return (
    <div>
      <span onClick={onBack} style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}>
        ← Back to Issues
      </span>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 600,
          margin: "12px 0 4px",
        }}
      >
        {issue.title}
      </h1>
      {issue.culprit && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            color: "var(--fg3)",
            marginBottom: 20,
          }}
        >
          {issue.culprit}
        </div>
      )}

      {issue.suspectCommit && (
        <div
          style={{
            border: "1px solid var(--line)",
            background: "var(--panel)",
            padding: "10px 14px",
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          <div style={{ color: "var(--fg3)", fontSize: 11, marginBottom: 4 }}>Suspect commit</div>
          <div style={{ color: "var(--fg2)" }}>{issue.suspectCommit.message}</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--fg3)",
              marginTop: 4,
            }}
          >
            {issue.suspectCommit.author} · {issue.suspectCommit.sha.slice(0, 7)}
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Stack trace</div>
      {frames.length === 0
        ? (
          <p style={{ color: "var(--fg2)", fontSize: 13 }}>
            No stack trace recorded for this event.
          </p>
        )
        : (
          <div
            style={{
              border: "1px solid var(--line)",
              background: "var(--code-bg)",
              marginBottom: 24,
            }}
          >
            {frames.map((frame, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 14px",
                  borderBottom: i < frames.length - 1 ? "1px solid var(--line2)" : "none",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  color: frame.in_app === false ? "var(--fg3)" : "var(--fg)",
                }}
              >
                {frame.function ?? "?"} —{" "}
                {frame.filename ?? frame.module ?? "?"}:{frame.lineno ?? "?"}
                {frame.colno != null ? `:${frame.colno}` : ""}
                {frame.resolved === false ? " (unresolved)" : ""}
              </div>
            ))}
          </div>
        )}

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Breadcrumbs</div>
      {(issue.latestEvent?.breadcrumbs ?? []).length === 0
        ? <p style={{ color: "var(--fg2)", fontSize: 13 }}>No breadcrumbs recorded.</p>
        : (
          <div
            style={{
              border: "1px solid var(--line)",
              background: "var(--panel)",
              marginBottom: 24,
            }}
          >
            {issue.latestEvent!.breadcrumbs.map((crumb, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--line2)",
                  fontSize: 12.5,
                }}
              >
                <span
                  style={{ color: "var(--fg3)", fontFamily: "var(--font-mono)", marginRight: 8 }}
                >
                  {crumb.category ?? "log"}
                </span>
                <span style={{ color: "var(--fg2)" }}>{crumb.message ?? ""}</span>
              </div>
            ))}
          </div>
        )}

      {issue.latestEvent && Object.keys(issue.latestEvent.tags).length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Tags</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
            {Object.entries(issue.latestEvent.tags).map(([key, value]) => (
              <span
                key={key}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  padding: "3px 8px",
                  background: "var(--chip)",
                  borderRadius: 4,
                }}
              >
                {key}: {value}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
