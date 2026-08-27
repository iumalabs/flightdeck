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

// Mirrors worker/modules/uptime/create-check.ts's MIN_INTERVAL_SECONDS — the one bound the
// PATCH /checks/:id route actually enforces server-side (routes.ts ~line 231). Kept as a literal
// rather than a cross-bundle import since the frontend and worker are built separately; if the
// backend constant ever changes, update this alongside it.
const MIN_INTERVAL_SECONDS = 60;

interface EditForm {
  name: string;
  target: string;
  intervalSeconds: string;
  failureThreshold: string;
  recoveryThreshold: string;
  webhookUrl: string;
}

function formToState(data: CheckDetail): EditForm {
  return {
    name: data.name,
    target: data.target,
    intervalSeconds: String(data.intervalSeconds),
    failureThreshold: String(data.failureThreshold),
    recoveryThreshold: String(data.recoveryThreshold),
    webhookUrl: data.webhookUrl ?? "",
  };
}

export function CheckDetailScreen({ checkId, projectId, onBack }: CheckDetailScreenProps) {
  const [loading, setLoading] = useState(true);
  const [check, setCheck] = useState<CheckDetail | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [lastTrigger, setLastTrigger] = useState<TriggerResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const params = projectId ? `?project=${projectId}` : "";
    fetch(`/api/internal/v1/checks/${checkId}${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<CheckDetail> : null))
      .then((data) => {
        setCheck(data);
        setForm(data ? formToState(data) : null);
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

  const updateForm = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setSaved(false);
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const saveDetails = async () => {
    if (!form) return;
    setSaveError(null);
    setSaved(false);

    const name = form.name.trim();
    const target = form.target.trim();
    const intervalSeconds = Number(form.intervalSeconds);
    const failureThreshold = Number(form.failureThreshold);
    const recoveryThreshold = Number(form.recoveryThreshold);

    if (!name) return setSaveError("Name is required.");
    if (!target) return setSaveError("Target is required.");
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS) {
      return setSaveError(
        `Interval must be a whole number of at least ${MIN_INTERVAL_SECONDS} seconds.`,
      );
    }
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
      return setSaveError("Failure threshold must be a positive whole number.");
    }
    if (!Number.isInteger(recoveryThreshold) || recoveryThreshold < 1) {
      return setSaveError("Recovery threshold must be a positive whole number.");
    }

    setSaving(true);
    try {
      const params = projectId ? `?project=${projectId}` : "";
      const res = await fetch(`/api/internal/v1/checks/${checkId}${params}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          target,
          intervalSeconds,
          failureThreshold,
          recoveryThreshold,
          webhookUrl: form.webhookUrl || null,
        }),
      });
      if (res.ok) {
        setSaved(true);
        load();
      } else {
        setSaveError("Could not save changes.");
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteCheck = async () => {
    setDeleteError(null);
    setDeleting(true);
    try {
      const params = projectId ? `?project=${projectId}` : "";
      const res = await fetch(`/api/internal/v1/checks/${checkId}${params}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        onBack();
      } else {
        setDeleteError("Could not delete check.");
        setConfirmingDelete(false);
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return null;

  if (!check || !form) {
    return (
      <div>
        <span
          onClick={onBack}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onBack();
            }
          }}
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}
        >
          ← Back to Uptime
        </span>
        <p style={{ color: "var(--fg2)", marginTop: 16 }}>Check not found.</p>
      </div>
    );
  }

  return (
    <div>
      <span
        onClick={onBack}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onBack();
          }
        }}
        role="button"
        tabIndex={0}
        style={{ cursor: "pointer", color: "var(--fg2)", fontSize: 13 }}
      >
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
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Check settings</div>

        <label style={labelStyle}>
          Name
          <input
            value={form.name}
            onChange={(e) => updateForm("name", e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Target
          <input
            value={form.target}
            onChange={(e) => updateForm("target", e.target.value)}
            style={inputStyle}
          />
        </label>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <label style={{ ...labelStyle, flex: "1 1 120px", minWidth: 0 }}>
            Interval (seconds)
            <input
              type="number"
              min={MIN_INTERVAL_SECONDS}
              step={1}
              value={form.intervalSeconds}
              onChange={(e) => updateForm("intervalSeconds", e.target.value)}
              style={{ ...inputStyle, width: "100%" }}
            />
          </label>
          <label style={{ ...labelStyle, flex: "1 1 120px", minWidth: 0 }}>
            Failure threshold
            <input
              type="number"
              min={1}
              step={1}
              value={form.failureThreshold}
              onChange={(e) => updateForm("failureThreshold", e.target.value)}
              style={{ ...inputStyle, width: "100%" }}
            />
          </label>
          <label style={{ ...labelStyle, flex: "1 1 120px", minWidth: 0 }}>
            Recovery threshold
            <input
              type="number"
              min={1}
              step={1}
              value={form.recoveryThreshold}
              onChange={(e) => updateForm("recoveryThreshold", e.target.value)}
              style={{ ...inputStyle, width: "100%" }}
            />
          </label>
        </div>

        <label style={labelStyle}>
          Webhook URL
          <input
            placeholder="https://example.com/hook (optional)"
            value={form.webhookUrl}
            onChange={(e) => updateForm("webhookUrl", e.target.value)}
            style={inputStyle}
          />
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={saveDetails} disabled={saving} style={buttonStyle}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saved && <span style={{ fontSize: 12.5, color: "var(--accent)" }}>Saved.</span>}
          {saveError && <span style={{ fontSize: 12.5, color: "#FF4D4D" }}>{saveError}</span>}
        </div>
      </div>

      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--panel)",
          maxWidth: 480,
          padding: 18,
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          Delete this check
          <div style={{ fontWeight: 400, fontSize: 12.5, color: "var(--fg2)", marginTop: 2 }}>
            Removes the check along with its run history and incidents. This cannot be undone.
          </div>
        </div>
        {confirmingDelete
          ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                style={secondaryButtonStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteCheck}
                disabled={deleting}
                style={dangerButtonStyle}
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
            </>
          )
          : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              style={secondaryButtonStyle}
            >
              Delete check
            </button>
          )}
        {deleteError && <span style={{ fontSize: 12.5, color: "#FF4D4D" }}>{deleteError}</span>}
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

const secondaryButtonStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 10px",
  background: "transparent",
  color: "var(--fg2)",
  border: "1px solid var(--line2)",
  borderRadius: 4,
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 10px",
  background: "#FF4D4D",
  color: "#1A0000",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "var(--fg2)",
};

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 10px",
  background: "var(--code-bg)",
  border: "1px solid var(--line2)",
  borderRadius: 4,
  color: "var(--fg)",
  boxSizing: "border-box",
};
