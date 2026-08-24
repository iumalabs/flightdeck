import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState.tsx";

interface Incident {
  id: string;
  checkId: string;
  checkName: string;
  openedAt: string;
  resolvedAt: string | null;
}

export interface AlertsScreenProps {
  projectId: string | null;
  onSelectCheck: (id: string) => void;
}

export function AlertsScreen({ projectId, onSelectCheck }: AlertsScreenProps) {
  const [loading, setLoading] = useState(true);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = projectId ? `?project=${projectId}` : "";
    fetch(`/api/internal/v1/incidents${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ incidents: Incident[] }> : null))
      .then((data) => {
        if (!cancelled) setIncidents(data?.incidents ?? []);
      })
      .catch(() => {
        if (!cancelled) setIncidents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
        Alerts
      </h1>

      {loading
        ? null
        : incidents && incidents.length > 0
        ? (
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
            {incidents.map((incident) => (
              <div
                key={incident.id}
                onClick={() => onSelectCheck(incident.checkId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
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
                    background: incident.resolvedAt ? "var(--fg3)" : "#FF4D4D",
                  }}
                />
                <span style={{ flex: 1, fontFamily: "var(--font-mono)" }}>
                  {incident.checkName}
                </span>
                <span
                  style={{ color: incident.resolvedAt ? "var(--fg2)" : "#FF4D4D", fontSize: 12.5 }}
                >
                  {incident.resolvedAt ? "resolved" : "open"}
                </span>
                <span style={{ color: "var(--fg3)", fontSize: 12 }}>{incident.openedAt}</span>
              </div>
            ))}
          </div>
        )
        : (
          <EmptyState
            title="No incidents yet"
            body="Incidents will show up here when one of your uptime checks crosses its failure threshold — and clear automatically once it recovers."
          />
        )}
    </div>
  );
}
