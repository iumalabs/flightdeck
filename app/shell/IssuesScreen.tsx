import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState.tsx";

interface Issue {
  id: string;
  title: string;
  culprit: string | null;
  level: string;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
}

const LEVEL_COLOR: Record<string, string> = {
  error: "#FF4D4D",
  warning: "#FFC53D",
  info: "#4FD1C5",
};

export interface IssuesScreenProps {
  onSelectIssue: (id: string) => void;
}

export function IssuesScreen({ onSelectIssue }: IssuesScreenProps) {
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState<Issue[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/internal/issues", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ issues: Issue[] }> : null))
      .then((data) => {
        if (!cancelled) setIssues(data?.issues ?? []);
      })
      .catch(() => {
        if (!cancelled) setIssues([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        Issues
      </h1>

      {loading
        ? null
        : issues && issues.length > 0
        ? (
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {issues.map((issue) => (
              <div
                key={issue.id}
                onClick={() => onSelectIssue(issue.id)}
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
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    flex: "none",
                    background: LEVEL_COLOR[issue.level] ?? "var(--fg3)",
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {issue.title}
                  </div>
                  {issue.culprit && (
                    <div
                      style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg3)" }}
                    >
                      {issue.culprit}
                    </div>
                  )}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg2)" }}>
                  {issue.eventCount}
                </span>
              </div>
            ))}
          </div>
        )
        : (
          <EmptyState
            title="No issues yet"
            body="Install an SDK to get started — errors will show up here, grouped and with full stack traces."
          />
        )}
    </div>
  );
}
