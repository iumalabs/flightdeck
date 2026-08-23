import { useEffect, useState } from "react";
import { layoutWaterfall } from "../../worker/modules/ingest/waterfall-layout.ts";
import type { LayoutSpan, RawSpan } from "../../worker/modules/ingest/waterfall-layout.ts";

interface LinkedError {
  issueId: string;
  title: string;
  level: string;
}

interface LinkedLog {
  timestamp: string;
  level: string;
  body: string;
}

interface TransactionDetail {
  id: string;
  traceId: string;
  name: string;
  op: string | null;
  durationMs: number;
  startedAt: string;
  startTimestamp: number;
  spans: RawSpan[];
  linkedErrors: LinkedError[];
  logs: LinkedLog[];
}

export interface TraceDetailScreenProps {
  transactionId: string;
  projectId: string | null;
  onBack: () => void;
  onSelectIssue: (id: string) => void;
}

const LEVEL_COLOR: Record<string, string> = {
  error: "#FF4D4D",
  warning: "#FFC53D",
  info: "#4FD1C5",
};

export function TraceDetailScreen(
  { transactionId, projectId, onBack, onSelectIssue }: TraceDetailScreenProps,
) {
  const [loading, setLoading] = useState(true);
  const [transaction, setTransaction] = useState<TransactionDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = projectId ? `?project=${projectId}` : "";
    fetch(`/api/internal/v1/traces/${transactionId}${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<TransactionDetail> : null))
      .then((data) => {
        if (!cancelled) setTransaction(data);
      })
      .catch(() => {
        if (!cancelled) setTransaction(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transactionId, projectId]);

  if (loading) return null;

  if (!transaction) {
    return (
      <div>
        <span onClick={onBack} style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}>
          ← Back to Traces
        </span>
        <p style={{ color: "var(--fg2)", marginTop: 16 }}>Transaction not found.</p>
      </div>
    );
  }

  const transactionEnd = transaction.startTimestamp + transaction.durationMs / 1000;
  const laidOut: LayoutSpan[] = layoutWaterfall(
    transaction.startTimestamp,
    transactionEnd,
    transaction.spans,
  );

  return (
    <div>
      <span onClick={onBack} style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}>
        ← Back to Traces
      </span>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 600,
          margin: "12px 0 4px",
        }}
      >
        {transaction.name}
      </h1>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          color: "var(--fg3)",
          marginBottom: 20,
        }}
      >
        {transaction.op ?? "—"} · {transaction.durationMs}ms · {transaction.startedAt}
      </div>

      {transaction.linkedErrors.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            Errors during this trace
          </div>
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {transaction.linkedErrors.map((err) => (
              <div
                key={err.issueId}
                onClick={() => onSelectIssue(err.issueId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--line2)",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    flex: "none",
                    background: LEVEL_COLOR[err.level] ?? "var(--fg3)",
                  }}
                />
                <span style={{ fontFamily: "var(--font-mono)" }}>{err.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {transaction.logs.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            Logs during this trace
          </div>
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {transaction.logs.map((log, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--line2)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg3)" }}>
                  {log.timestamp}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--fg2)",
                    textTransform: "uppercase",
                    width: 44,
                  }}
                >
                  {log.level}
                </span>
                <span style={{ flex: 1 }}>{log.body}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Waterfall</div>
      {laidOut.length === 0
        ? (
          <p style={{ color: "var(--fg2)", fontSize: 13 }}>
            This transaction recorded no spans of its own.
          </p>
        )
        : (
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)", padding: 14 }}>
            {laidOut.map((span) => (
              <div
                key={span.span_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "6px 0",
                  paddingLeft: (span.depth - 1) * 16,
                }}
              >
                <span
                  style={{
                    width: 220,
                    flex: "none",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: "var(--fg2)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    paddingRight: 12,
                  }}
                  title={span.description ?? span.op ?? ""}
                >
                  {span.op ?? "span"}
                  {span.description ? ` · ${span.description}` : ""}
                </span>
                <span style={{ flex: 1, position: "relative", height: 16 }}>
                  <span
                    style={{
                      position: "absolute",
                      left: `${span.leftPercent}%`,
                      width: `${span.widthPercent}%`,
                      height: "100%",
                      borderRadius: 3,
                      background: span.status && span.status !== "ok" ? "#FF4D4D" : "var(--accent)",
                      opacity: 0.85,
                    }}
                    title={`${Math.round((span.timestamp - span.start_timestamp) * 1000)}ms`}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
