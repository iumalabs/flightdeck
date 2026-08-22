import { useEffect, useState } from "react";
import type { Session } from "../lib/use-session.ts";

interface Project {
  id: string;
  name: string;
}

type UploadStatus = { kind: "idle" } | { kind: "success" } | { kind: "error"; message: string };

function SourceMapUpload({ project }: { project: Project | null }) {
  const [release, setRelease] = useState("");
  const [pathPattern, setPathPattern] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !file) return;

    const form = new FormData();
    form.set("release", release);
    form.set("minifiedPathPattern", pathPattern);
    form.set("file", file);

    const res = await fetch(`/api/internal/projects/${project.id}/source-maps`, {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });

    if (res.ok) {
      setStatus({ kind: "success" });
      setRelease("");
      setPathPattern("");
      setFile(null);
    } else {
      setStatus({
        kind: "error",
        message: res.status === 413 ? "File too large." : "Upload failed.",
      });
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        background: "var(--panel)",
        maxWidth: 480,
        padding: 18,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Upload source map</div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          placeholder="Release (e.g. 1.4.2)"
          value={release}
          onChange={(e) => setRelease(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          placeholder="Minified path (e.g. app.min.js)"
          value={pathPattern}
          onChange={(e) => setPathPattern(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="file"
          accept=".map,application/json"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
          style={{ fontSize: 12.5 }}
        />
        <button type="submit" disabled={!project} style={buttonStyle}>
          Upload
        </button>
        {status.kind === "success" && (
          <span style={{ color: "var(--accent)", fontSize: 12.5 }}>Uploaded.</span>
        )}
        {status.kind === "error" && (
          <span style={{ color: "#FF4D4D", fontSize: 12.5 }}>{status.message}</span>
        )}
      </form>
    </div>
  );
}

type ConnectStatus = { kind: "idle" } | { kind: "connected" } | { kind: "disconnected" } | {
  kind: "error";
};

// contracts/internal-api.md deliberately has no endpoint to browse/select repos or read back the
// current connection (non-goal) — FlightDeck records the result of GitHub's own App installation
// flow, it doesn't build a repo picker. In a real deployment `installationId`/`owner`/`repo` come
// from that installation flow's callback; this form accepts them directly as this module's minimal
// stand-in for wiring up that redirect.
function GitHubConnect({ project }: { project: Project | null }) {
  const [installationId, setInstallationId] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [status, setStatus] = useState<ConnectStatus>({ kind: "idle" });

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;

    const res = await fetch(`/api/internal/projects/${project.id}/github/connect`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId, owner, repo }),
    });
    setStatus(res.ok ? { kind: "connected" } : { kind: "error" });
  };

  const disconnect = async () => {
    if (!project) return;
    const res = await fetch(`/api/internal/projects/${project.id}/github`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    setStatus(res.ok ? { kind: "disconnected" } : { kind: "error" });
  };

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        background: "var(--panel)",
        maxWidth: 480,
        padding: 18,
        marginTop: 20,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Connect GitHub</div>
      <form onSubmit={connect} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          placeholder="Installation ID"
          value={installationId}
          onChange={(e) => setInstallationId(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          placeholder="Owner (e.g. iumalabs)"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          placeholder="Repo (e.g. flightdeck)"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          required
          style={inputStyle}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={!project} style={buttonStyle}>
            Connect
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={!project}
            style={secondaryButtonStyle}
          >
            Disconnect
          </button>
        </div>
        {status.kind === "connected" && (
          <span style={{ color: "var(--accent)", fontSize: 12.5 }}>Repository connected.</span>
        )}
        {status.kind === "disconnected" && (
          <span style={{ color: "var(--fg2)", fontSize: 12.5 }}>Repository disconnected.</span>
        )}
        {status.kind === "error" && (
          <span style={{ color: "#FF4D4D", fontSize: 12.5 }}>Request failed.</span>
        )}
      </form>
    </div>
  );
}

type ExportStatus = { kind: "idle" } | { kind: "provisioned"; credential: ExportCredential } | {
  kind: "revoked";
} | { kind: "error" };

interface ExportCredential {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
}

// contracts/logs-internal-api.md (specs/004-structured-logs) — the secret is shown ONCE, at
// provisioning time, and never retrievable again (data-model.md's Export Credential section).
function LogExport({ project }: { project: Project | null }) {
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });

  const provision = async () => {
    if (!project) return;
    const res = await fetch(`/api/internal/projects/${project.id}/log-export/credential`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (res.ok) {
      setStatus({ kind: "provisioned", credential: await res.json() as ExportCredential });
    } else {
      setStatus({ kind: "error" });
    }
  };

  const revoke = async () => {
    if (!project) return;
    const res = await fetch(`/api/internal/projects/${project.id}/log-export/credential`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    setStatus(res.ok ? { kind: "revoked" } : { kind: "error" });
  };

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        background: "var(--panel)",
        maxWidth: 480,
        padding: 18,
        marginTop: 20,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        S3-compatible log export
      </div>
      <p style={{ fontSize: 12.5, color: "var(--fg3)", marginBottom: 12 }}>
        Provision revocable, project-scoped credentials for a standard S3-compatible client — the
        secret is shown once, here, and never retrievable again.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={provision} disabled={!project} style={buttonStyle}>
          Generate credentials
        </button>
        <button type="button" onClick={revoke} disabled={!project} style={secondaryButtonStyle}>
          Revoke
        </button>
      </div>
      {status.kind === "provisioned" && (
        <div
          style={{
            marginTop: 12,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--fg2)",
            wordBreak: "break-all",
          }}
        >
          <div>Access Key ID: {status.credential.accessKeyId}</div>
          <div>Secret Access Key: {status.credential.secretAccessKey}</div>
          <div>Endpoint: {status.credential.endpoint}</div>
          <div>Bucket: {status.credential.bucket}</div>
        </div>
      )}
      {status.kind === "revoked" && (
        <span style={{ color: "var(--fg2)", fontSize: 12.5 }}>Export access revoked.</span>
      )}
      {status.kind === "error" && (
        <span style={{ color: "#FF4D4D", fontSize: 12.5 }}>Request failed.</span>
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

export function SettingsScreen({ session }: { session: Session }) {
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/internal/projects", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<{ projects: Project[] }> : null))
      .then((data) => {
        if (!cancelled) setProject(data?.projects?.[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setProject(null);
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
        Settings
      </h1>
      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--panel)",
          maxWidth: 480,
          marginBottom: 24,
        }}
      >
        {[
          ["Email", session.email],
          ["Role", session.role],
          ["Identifier", session.sub],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              gap: 18,
              padding: "12px 18px",
              borderBottom: "1px solid var(--line2)",
            }}
          >
            <span style={{ width: 110, flex: "none", fontSize: 13, color: "var(--fg3)" }}>
              {label}
            </span>
            <span style={{ fontSize: 13.5, fontFamily: "var(--font-mono)" }}>{value}</span>
          </div>
        ))}
      </div>

      <SourceMapUpload project={project} />
      <GitHubConnect project={project} />
      <LogExport project={project} />

      <p style={{ fontSize: 13, color: "var(--fg3)", marginTop: 16, maxWidth: 480 }}>
        Member management, project settings and billing are not part of this workspace yet.
      </p>
    </div>
  );
}
