import { useEffect, useState } from "react";

interface RecentRun {
  trigger: string;
  succeeded: boolean;
  latencyMs: number | null;
  detail: string | null;
  runAt: string;
}

interface Incident {
  id: string;
  openedAt: string;
  resolvedAt: string | null;
}

interface CheckDetail {
  id: string;
  name: string;
  type: string;
  target: string;
  intervalSeconds: number;
  failureThreshold: number;
  recoveryThreshold: number;
  webhookUrl: string | null;
  status: string;
  uptimePercent: number | null;
  recentRuns: RecentRun[];
  incidents: Incident[];
}

interface TriggerResult {
  succeeded: boolean;
  latencyMs: number | null;
  detail: string | null;
  status: string;
  incidentOpened: boolean;
  incidentResolved: boolean;
}

export interface CheckDetailScreenProps {
  checkId: string;
  projectId: string | null;
  onBack: () => void;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export function CheckDetailScreen({ checkId, projectId, onBack }: CheckDetailScreenProps) {
  const [loading, setLoading] = useState(true);
  const [check, setCheck] = useState<CheckDetail | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [lastTrigger, setLastTrigger] = useState<TriggerResult | null>(null);

  const load = () => {
    setLoading(true);
    const params = projectId ? `?project=${projectId}` : "";
    fetch(`/api/internal/v1/checks/${checkId}${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<CheckDetail> : null))
      .then((data) => {
        setCheck(data);
        setWebhookUrl(data?.webhookUrl ?? "");
      })
      .catch(() => setCheck(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [checkId, projectId]);

  const triggerNow = async () => {
    setTriggering(true);
    setLastTrigger(null);
    try {
      const res = await fetch(`/api/internal/v1/checks/${checkId}/trigger`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (res.ok) {
        setLastTrigger(await res.json() as TriggerResult);
        load();
      }
    } finally {
      setTriggering(false);
    }
  };

  const saveWebhook = async () => {
    const params = projectId ? `?project=${projectId}` : "";
    await fetch(`/api/internal/v1/checks/${checkId}${params}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl: webhookUrl || null }),
    });
    load();
  };

  if (loading) return null;

  if (!check) {
    return (
      <div>
        <span onClick={onBack} style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}>
          ← Back to Uptime
        </span>
        <p style={{ color: "var(--fg2)", marginTop: 16 }}>Check not found.</p>
      </div>
    );
  }

  return (
    <div>
      <span onClick={onBack} style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}>
        ← Back to Uptime
      </span>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 600,
          margin: "12px 0 4px",
        }}
      >
        {check.name}
      </h1>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          color: "var(--fg3)",
          marginBottom: 20,
        }}
      >
        {check.type.toUpperCase()} · {check.target} · status: {check.status} · uptime:{" "}
        {formatPercent(check.uptimePercent)}
      </div>

      <div style={{ marginBottom: 24, display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={triggerNow}
          disabled={triggering}
          style={buttonStyle}
        >
          {triggering ? "Testing…" : "Test this check now"}
        </button>
        {lastTrigger && (
          <span style={{ fontSize: 12.5, color: "var(--fg2)" }}>
            {lastTrigger.status} — {lastTrigger.detail ?? "no detail"}
            {lastTrigger.incidentOpened && " · incident opened"}
            {lastTrigger.incidentResolved && " · incident resolved"}
          </span>
        )}
      </div>

      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--panel)",
          maxWidth: 480,
          padding: 18,
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Webhook URL</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input
            placeholder="https://example.com/hook (optional)"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              padding: "6px 10px",
              background: "var(--code-bg)",
              border: "1px solid var(--line2)",
              borderRadius: 4,
              color: "var(--fg)",
            }}
          />
          <button type="button" onClick={saveWebhook} style={buttonStyle}>Save</button>
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Incidents</div>
      {check.incidents.length === 0
        ? <p style={{ color: "var(--fg2)", fontSize: 13, marginBottom: 24 }}>No incidents yet.</p>
        : (
          <div
            style={{
              border: "1px solid var(--line)",
              background: "var(--panel)",
              marginBottom: 24,
            }}
          >
            {check.incidents.map((incident) => (
              <div
                key={incident.id}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--line2)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: incident.resolvedAt ? "var(--fg2)" : "#FF4D4D" }}>
                  {incident.resolvedAt ? "resolved" : "open"}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg3)" }}>
                  opened {incident.openedAt}
                  {incident.resolvedAt ? ` · resolved ${incident.resolvedAt}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Recent runs</div>
      {check.recentRuns.length === 0
        ? <p style={{ color: "var(--fg2)", fontSize: 13 }}>No runs recorded yet.</p>
        : (
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {check.recentRuns.map((run, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--line2)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: run.succeeded ? "var(--accent)" : "#FF4D4D", width: 60 }}>
                  {run.succeeded ? "up" : "down"}
                </span>
                <span style={{ color: "var(--fg3)", width: 80 }}>{run.trigger}</span>
                <span style={{ color: "var(--fg3)", width: 80 }}>
                  {run.latencyMs !== null ? `${run.latencyMs}ms` : "—"}
                </span>
                <span style={{ color: "var(--fg2)", flex: 1 }}>{run.detail ?? "—"}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg3)" }}>
                  {run.runAt}
                </span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 10px",
  background: "var(--accent)",
  color: "#0A0F0A",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontWeight: 600,
};
