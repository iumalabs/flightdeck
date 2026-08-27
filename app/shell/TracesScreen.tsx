import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState.tsx";

interface Operation {
  name: string;
  op: string | null;
  p50Ms: number;
  p95Ms: number;
  count: number;
  latestTransactionId: string;
}

export interface TracesScreenProps {
  projectId: string | null;
  onSelectTransaction: (id: string) => void;
}

export function TracesScreen({ projectId, onSelectTransaction }: TracesScreenProps) {
  const [loading, setLoading] = useState(true);
  const [operations, setOperations] = useState<Operation[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = projectId ? `?project=${projectId}` : "";
    fetch(`/api/internal/v1/traces${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ operations: Operation[] }> : null))
      .then((data) => {
        if (!cancelled) setOperations(data?.operations ?? []);
      })
      .catch(() => {
        if (!cancelled) setOperations([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const sorted = [...(operations ?? [])].sort((a, b) => b.p95Ms - a.p95Ms);

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
        Traces
      </h1>

      {loading
        ? null
        : sorted.length > 0
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
              <span style={{ flex: 1 }}>Operation</span>
              <span>Count</span>
            </div>
            {sorted.map((op) => (
              <div
                key={op.name}
                onClick={() => onSelectTransaction(op.latestTransactionId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectTransaction(op.latestTransactionId);
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
                {
                  /* issues/108 — p50/p95 move into the muted subline (the same `·`-joined
                    metadata idiom used elsewhere, e.g. IssueDetailScreen's suspect-commit line)
                    instead of two more fixed-width trailing columns, so the flex:1 name span
                    keeps enough room to stay legible at narrow widths. */
                }
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
                    {op.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--fg3)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {op.op ? `${op.op} · ` : ""}p50 {op.p50Ms}ms · p95 {op.p95Ms}ms
                  </div>
                </span>
                <span
                  style={{
                    flex: "none",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--fg2)",
                  }}
                >
                  {op.count}
                </span>
              </div>
            ))}
          </div>
        )
        : (
          <EmptyState
            title="No traces yet"
            body="Once your SDK reports spans, distributed traces will appear here as waterfalls across services."
          />
        )}
    </div>
  );
}
