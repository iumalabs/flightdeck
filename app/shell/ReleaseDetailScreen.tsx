import { useEffect, useState } from "react";

interface EnvironmentFigures {
  environment: string;
  adoptionPercent: number;
  crashFreeSessionRate: number | null;
  crashFreeUserRate: number | null;
}

interface Commit {
  sha: string;
  message: string | null;
  author: string | null;
}

interface Deploy {
  environment: string;
  deployedAt: string;
}

interface RegressedIssue {
  issueId: string;
  title: string;
}

interface ReleaseDetail {
  id: string;
  version: string;
  dateReleased: string | null;
  environments: EnvironmentFigures[];
  commits: Commit[];
  deploys: Deploy[];
  regressedIssues: RegressedIssue[];
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export interface ReleaseDetailScreenProps {
  releaseId: string;
  projectId: string | null;
  onBack: () => void;
  onSelectIssue: (id: string) => void;
}

export function ReleaseDetailScreen(
  { releaseId, projectId, onBack, onSelectIssue }: ReleaseDetailScreenProps,
) {
  const [loading, setLoading] = useState(true);
  const [release, setRelease] = useState<ReleaseDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = projectId ? `?project=${projectId}` : "";
    fetch(`/api/internal/v1/releases/${releaseId}${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<ReleaseDetail> : null))
      .then((data) => {
        if (!cancelled) setRelease(data);
      })
      .catch(() => {
        if (!cancelled) setRelease(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [releaseId, projectId]);

  if (loading) return null;

  if (!release) {
    return (
      <div>
        <span onClick={onBack} style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}>
          ← Back to Releases
        </span>
        <p style={{ color: "var(--fg2)", marginTop: 16 }}>Release not found.</p>
      </div>
    );
  }

  return (
    <div>
      <span onClick={onBack} style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}>
        ← Back to Releases
      </span>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 600,
          margin: "12px 0 4px",
        }}
      >
        {release.version}
      </h1>
      <div style={{ fontSize: 12.5, color: "var(--fg3)", marginBottom: 20 }}>
        {release.dateReleased ? `Released ${release.dateReleased}` : "Not finalized"}
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Health by environment</div>
      {release.environments.length === 0
        ? (
          <p style={{ color: "var(--fg2)", fontSize: 13, marginBottom: 20 }}>
            No session data yet.
          </p>
        )
        : (
          <div
            style={{
              border: "1px solid var(--line)",
              background: "var(--panel)",
              marginBottom: 24,
            }}
          >
            {release.environments.map((env) => (
              <div
                key={env.environment}
                style={{
                  display: "flex",
                  gap: 16,
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--line2)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ flex: 1, fontFamily: "var(--font-mono)" }}>{env.environment}</span>
                <span>Adoption: {formatPercent(env.adoptionPercent)}</span>
                <span>Crash-free sessions: {formatPercent(env.crashFreeSessionRate)}</span>
                <span>Crash-free users: {formatPercent(env.crashFreeUserRate)}</span>
              </div>
            ))}
          </div>
        )}

      {release.regressedIssues.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            Regressed in this release
          </div>
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {release.regressedIssues.map((issue) => (
              <div
                key={issue.issueId}
                onClick={() => onSelectIssue(issue.issueId)}
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--line2)",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                }}
              >
                {issue.title}
              </div>
            ))}
          </div>
        </div>
      )}

      {release.commits.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Commits</div>
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {release.commits.map((commit) => (
              <div
                key={commit.sha}
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--line2)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg3)" }}>
                  {commit.sha.slice(0, 7)}
                </span>{" "}
                {commit.message} — {commit.author}
              </div>
            ))}
          </div>
        </div>
      )}

      {release.deploys.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Deploys</div>
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {release.deploys.map((deploy, i) => (
              <div
                key={i}
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--line2)",
                  fontSize: 12.5,
                }}
              >
                {deploy.environment} — {deploy.deployedAt}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
