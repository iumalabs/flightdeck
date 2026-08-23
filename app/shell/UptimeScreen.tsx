import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState.tsx";

interface Check {
  id: string;
  name: string;
  type: string;
  target: string;
  status: string;
  uptimePercent: number | null;
}

const STATUS_COLOR: Record<string, string> = {
  up: "var(--accent)",
  down: "#FF4D4D",
  unknown: "var(--fg3)",
};

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export interface UptimeScreenProps {
  projectId: string | null;
  onSelectCheck: (id: string) => void;
}

export function UptimeScreen({ projectId, onSelectCheck }: UptimeScreenProps) {
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"http" | "tcp">("http");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const params = projectId ? `?project=${projectId}` : "";
    fetch(`/api/internal/v1/checks${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ checks: Check[] }> : null))
      .then((data) => setChecks(data?.checks ?? []))
      .catch(() => setChecks([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [projectId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const params = projectId ? `?project=${projectId}` : "";
    const res = await fetch(`/api/internal/v1/checks${params}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, target, intervalSeconds: 60 }),
    });
    if (res.ok) {
      setName("");
      setTarget("");
      load();
    } else {
      setError(
        res.status === 403
          ? "This project has reached its check limit."
          : "Could not create check.",
      );
    }
  };

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
        Uptime
      </h1>

      <form
        onSubmit={submit}
        style={{
          border: "1px solid var(--line)",
          background: "var(--panel)",
          maxWidth: 480,
          padding: 18,
          marginBottom: 24,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Add a check</div>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={inputStyle}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "http" | "tcp")}
          style={inputStyle}
        >
          {
            /* issues/38 — <option> ignores the <select>'s own color/background, falling back to
              native (light) popup styling unless styled explicitly here too. */
          }
          <option value="http" style={optionStyle}>HTTP</option>
          <option value="tcp" style={optionStyle}>TCP</option>
        </select>
        <input
          placeholder={type === "http" ? "https://example.com" : "host:port"}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
          style={inputStyle}
        />
        <button type="submit" style={buttonStyle}>Add check</button>
        {error && <span style={{ color: "#FF4D4D", fontSize: 12.5 }}>{error}</span>}
      </form>

      {loading
        ? null
        : checks && checks.length > 0
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
              <span style={{ flex: 1 }}>Name</span>
              <span style={{ width: 80 }}>Type</span>
              <span style={{ width: 90 }}>Status</span>
              <span style={{ width: 90, textAlign: "right" }}>Uptime</span>
            </div>
            {checks.map((check) => (
              <div
                key={check.id}
                onClick={() => onSelectCheck(check.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--line2)",
                  cursor: "pointer",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>
                  {check.name}
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      color: "var(--fg3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {check.target}
                  </div>
                </span>
                <span style={{ width: 80, fontSize: 12.5, textTransform: "uppercase" }}>
                  {check.type}
                </span>
                <span style={{ width: 90, display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: STATUS_COLOR[check.status] ?? "var(--fg3)",
                    }}
                  />
                  <span style={{ fontSize: 12.5 }}>{check.status}</span>
                </span>
                <span style={{ width: 90, textAlign: "right", fontSize: 12.5 }}>
                  {formatPercent(check.uptimePercent)}
                </span>
              </div>
            ))}
          </div>
        )
        : (
          <EmptyState
            title="No uptime checks yet"
            body="Add a check above and FlightDeck will monitor it every minute."
          />
        )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 10px",
  background: "var(--code-bg)",
  border: "1px solid var(--line2)",
  borderRadius: 4,
  color: "var(--fg)",
};

const optionStyle: React.CSSProperties = { background: "var(--code-bg)", color: "var(--fg)" };

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
