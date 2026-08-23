import { useEffect, useState } from "react";
import type { Session } from "../lib/use-session.ts";
import { EmptyState } from "../components/EmptyState.tsx";

interface Counts {
  unresolvedIssues: number;
  operations: number;
  releases: number;
  checks: number;
  checksDown: number;
  feedback: number;
}

const EMPTY_COUNTS: Counts = {
  unresolvedIssues: 0,
  operations: 0,
  releases: 0,
  checks: 0,
  checksDown: 0,
  feedback: 0,
};

async function fetchCount(url: string): Promise<unknown[]> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) return [];
  const body = await res.json() as Record<string, unknown[]>;
  return Object.values(body)[0] ?? [];
}

// issues/29 — this was Module 1's original empty-state skeleton; every other pillar (Issues,
// Traces, Releases, Uptime, Feedback) grew its own real fetch() over Modules 2-7, but nothing ever
// came back to wire Overview up to them, so it kept claiming "no telemetry" even once a project
// genuinely had data. A lightweight per-pillar count, not a full redesign — each stat still lives
// on its own screen for the real detail.
export interface OverviewScreenProps {
  session: Session;
  projectId: string | null;
}

export function OverviewScreen({ session, projectId }: OverviewScreenProps) {
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = projectId ? `?project=${projectId}` : "";

    Promise.all([
      fetchCount(`/api/internal/v1/issues${params}`),
      fetchCount(`/api/internal/v1/traces${params}`),
      fetchCount(`/api/internal/v1/releases${params}`),
      fetchCount(`/api/internal/v1/checks${params}`),
      fetchCount(`/api/internal/v1/feedback${params}`),
    ])
      .then(([issues, operations, releases, checks, feedback]) => {
        if (cancelled) return;
        setCounts({
          unresolvedIssues: issues.length,
          operations: operations.length,
          releases: releases.length,
          checks: checks.length,
          checksDown: (checks as { status?: string }[]).filter((c) => c.status === "down").length,
          feedback: feedback.length,
        });
      })
      .catch(() => {
        if (!cancelled) setCounts(EMPTY_COUNTS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const hasData = counts.unresolvedIssues > 0 || counts.operations > 0 || counts.releases > 0 ||
    counts.checks > 0 || counts.feedback > 0;

  const tiles: { label: string; value: number; detail?: string }[] = [
    { label: "Unresolved issues", value: counts.unresolvedIssues },
    { label: "Traced operations", value: counts.operations },
    { label: "Releases", value: counts.releases },
    {
      label: "Uptime checks",
      value: counts.checks,
      detail: counts.checksDown > 0 ? `${counts.checksDown} down` : undefined,
    },
    { label: "Feedback items", value: counts.feedback },
  ];

  return (
    <div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          fontWeight: 600,
          margin: "0 0 8px",
        }}
      >
        Welcome, {session.email}
      </h1>

      {loading ? null : hasData
        ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            {tiles.map((tile) => (
              <div
                key={tile.label}
                style={{
                  border: "1px solid var(--line)",
                  background: "var(--panel)",
                  padding: "16px 18px",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 26,
                    fontWeight: 600,
                    color: tile.detail ? "#FF4D4D" : "var(--fg)",
                  }}
                >
                  {tile.value}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--fg3)", marginTop: 4 }}>
                  {tile.label}
                  {tile.detail ? ` · ${tile.detail}` : ""}
                </div>
              </div>
            ))}
          </div>
        )
        : (
          <>
            <p style={{ color: "var(--fg2)", fontSize: 14, margin: "0 0 24px" }}>
              This workspace has no telemetry yet.
            </p>
            <EmptyState
              title="No data yet"
              body="Install an SDK to start seeing errors, traces, logs, releases and uptime checks here."
            />
          </>
        )}
    </div>
  );
}
