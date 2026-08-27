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
  status: string;
}

const LEVEL_COLOR: Record<string, string> = {
  error: "#FF4D4D",
  warning: "#FFC53D",
  info: "#4FD1C5",
};

type StatusFilter = "unresolved" | "resolved" | "all";

// worker/modules/issues/routes.ts's GET / only distinguishes "unresolved" (the implicit default —
// any query value other than "all", including none) from "all" (every status). There's no
// server-side resolved-only filter, so the "Resolved" option below is fetched via "all" and
// narrowed client-side using each issue's own `status` field.
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "unresolved", label: "Unresolved" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

export interface IssuesScreenProps {
  projectId: string | null;
  onSelectIssue: (id: string) => void;
}

export function IssuesScreen({ projectId, onSelectIssue }: IssuesScreenProps) {
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unresolved");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (projectId) params.set("project", projectId);
    if (statusFilter !== "unresolved") params.set("status", "all");
    const qs = params.toString();
    fetch(`/api/internal/v1/issues${qs ? `?${qs}` : ""}`, { credentials: "same-origin" })
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
  }, [projectId, statusFilter]);

  const visibleIssues = statusFilter === "resolved"
    ? issues?.filter((issue) => issue.status === "resolved") ?? null
    : issues;

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

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {STATUS_FILTERS.map(({ value, label }) => (
          <span
            key={value}
            onClick={() => setStatusFilter(value)}
            style={{
              cursor: "pointer",
              padding: "3px 8px",
              borderRadius: 4,
              fontSize: 11.5,
              background: statusFilter === value ? "rgba(184,241,53,.12)" : "var(--chip)",
              color: statusFilter === value ? "var(--accent)" : "var(--fg2)",
            }}
          >
            {label}
          </span>
        ))}
      </div>

      {loading
        ? null
        : visibleIssues && visibleIssues.length > 0
        ? (
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {visibleIssues.map((issue) => (
              <div
                key={issue.id}
                onClick={() => onSelectIssue(issue.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectIssue(issue.id);
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
        : statusFilter === "unresolved"
        ? (
          <EmptyState
            title="No issues yet"
            body="Install an SDK to get started — errors will show up here, grouped and with full stack traces."
          />
        )
        : (
          <EmptyState
            title={statusFilter === "resolved" ? "No resolved issues" : "No issues"}
            body="Nothing matches this filter yet."
          />
        )}
    </div>
  );
}
