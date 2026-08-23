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
              <span style={{ width: 70, textAlign: "right" }}>p50</span>
              <span style={{ width: 70, textAlign: "right" }}>p95</span>
              <span style={{ width: 60, textAlign: "right" }}>Count</span>
            </div>
            {sorted.map((op) => (
              <div
                key={op.name}
                onClick={() => onSelectTransaction(op.latestTransactionId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--line2)",
                  cursor: "pointer",
                }}
              >
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
                  {op.op && (
                    <div
                      style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg3)" }}
                    >
                      {op.op}
                    </div>
                  )}
                </span>
                <span
                  style={{
                    width: 70,
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    color: "var(--fg2)",
                  }}
                >
                  {op.p50Ms}ms
                </span>
                <span
                  style={{
                    width: 70,
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    color: "var(--fg2)",
                  }}
                >
                  {op.p95Ms}ms
                </span>
                <span
                  style={{
                    width: 60,
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    color: "var(--fg3)",
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
