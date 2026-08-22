import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState.tsx";

interface Release {
  id: string;
  version: string;
  dateReleased: string | null;
  adoptionPercent: number | null;
  crashFreeSessionRate: number | null;
  crashFreeUserRate: number | null;
  deployCount: number;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export interface ReleasesScreenProps {
  onSelectRelease: (id: string) => void;
}

export function ReleasesScreen({ onSelectRelease }: ReleasesScreenProps) {
  const [loading, setLoading] = useState(true);
  const [releases, setReleases] = useState<Release[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/internal/releases", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ releases: Release[] }> : null))
      .then((data) => {
        if (!cancelled) setReleases(data?.releases ?? []);
      })
      .catch(() => {
        if (!cancelled) setReleases([]);
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
        Releases
      </h1>

      {loading
        ? null
        : releases && releases.length > 0
        ? (
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 16px",
                borderBottom: "1px solid var(--line2)",
                fontSize: 11,
                color: "var(--fg3)",
                textTransform: "uppercase",
                letterSpacing: ".08em",
              }}
            >
              <span style={{ flex: 1 }}>Version</span>
              <span style={{ width: 90, textAlign: "right" }}>Adoption</span>
              <span style={{ width: 110, textAlign: "right" }}>Crash-free sessions</span>
              <span style={{ width: 100, textAlign: "right" }}>Crash-free users</span>
              <span style={{ width: 70, textAlign: "right" }}>Deploys</span>
            </div>
            {releases.map((release) => (
              <div
                key={release.id}
                onClick={() => onSelectRelease(release.id)}
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
                  style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 13 }}
                >
                  {release.version}
                  {!release.dateReleased && (
                    <span style={{ color: "var(--fg3)", fontSize: 11, marginLeft: 8 }}>
                      unfinalized
                    </span>
                  )}
                </span>
                <span style={{ width: 90, textAlign: "right", fontSize: 12.5 }}>
                  {formatPercent(release.adoptionPercent)}
                </span>
                <span style={{ width: 110, textAlign: "right", fontSize: 12.5 }}>
                  {formatPercent(release.crashFreeSessionRate)}
                </span>
                <span style={{ width: 100, textAlign: "right", fontSize: 12.5 }}>
                  {formatPercent(release.crashFreeUserRate)}
                </span>
                <span
                  style={{ width: 70, textAlign: "right", fontSize: 12.5, color: "var(--fg3)" }}
                >
                  {release.deployCount}
                </span>
              </div>
            ))}
          </div>
        )
        : (
          <EmptyState
            title="No releases yet"
            body="Tell FlightDeck about a deploy and adoption, crash-free rate and regressions will show up here."
          />
        )}
    </div>
  );
}
