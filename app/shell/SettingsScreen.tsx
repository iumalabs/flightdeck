import { useState } from "react";
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

type CreateProjectStatus = { kind: "idle" } | { kind: "created"; dsn: string } | {
  kind: "error";
  message: string;
};

// contracts/projects-internal-api.md's POST /api/internal/projects (specs/008-multi-project-
// support) — the natural home alongside this screen's other per-project admin sections. Shows the
// returned `dsn` inline on success (spec User Story 3), no separate navigation.
function CreateProjectForm({ onCreated }: { onCreated: (project: Project) => void }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<CreateProjectStatus>({ kind: "idle" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const res = await fetch("/api/internal/projects", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (res.ok) {
      const project = await res.json() as Project & { dsn: string };
      setStatus({ kind: "created", dsn: project.dsn });
      setName("");
      onCreated({ id: project.id, name: project.name });
    } else {
      setStatus({ kind: "error", message: "Could not create project." });
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        background: "var(--panel)",
        maxWidth: 480,
        padding: 18,
        marginBottom: 24,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Create a project</div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          placeholder="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={inputStyle}
        />
        <button type="submit" style={buttonStyle}>Create project</button>
        {status.kind === "created" && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--fg2)",
              wordBreak: "break-all",
            }}
          >
            DSN: {status.dsn}
          </div>
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

type TokenStatus = { kind: "idle" } | { kind: "generated"; token: string } | { kind: "revoked" } | {
  kind: "error";
};

// contracts/releases-internal-api.md (specs/005-releases) — the raw token is shown ONCE, at
// generation time, and never retrievable again (data-model.md's API Token section), matching
// standard API-credential UX.
function ApiTokenSection({ project }: { project: Project | null }) {
  const [tokenId, setTokenId] = useState("");
  const [status, setStatus] = useState<TokenStatus>({ kind: "idle" });

  const generate = async () => {
    if (!project) return;
    const res = await fetch(`/api/internal/projects/${project.id}/api-tokens`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (res.ok) {
      const body = await res.json() as { id: string; token: string };
      setTokenId(body.id);
      setStatus({ kind: "generated", token: body.token });
    } else {
      setStatus({ kind: "error" });
    }
  };

  const revoke = async () => {
    if (!project || !tokenId) return;
    const res = await fetch(`/api/internal/projects/${project.id}/api-tokens/${tokenId}`, {
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
        sentry-cli API token
      </div>
      <p style={{ fontSize: 12.5, color: "var(--fg3)", marginBottom: 12 }}>
        Point a real, unmodified <code>sentry-cli</code> at this project via{" "}
        <code>SENTRY_URL</code>/<code>SENTRY_AUTH_TOKEN</code>{" "}
        — the secret is shown once, here, and never retrievable again.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={generate} disabled={!project} style={buttonStyle}>
          Generate token
        </button>
        <button
          type="button"
          onClick={revoke}
          disabled={!project || !tokenId}
          style={secondaryButtonStyle}
        >
          Revoke
        </button>
      </div>
      {status.kind === "generated" && (
        <div
          style={{
            marginTop: 12,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--fg2)",
            wordBreak: "break-all",
          }}
        >
          {status.token}
        </div>
      )}
      {status.kind === "revoked" && (
        <span style={{ color: "var(--fg2)", fontSize: 12.5 }}>Token revoked.</span>
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

export interface SettingsScreenProps {
  session: Session;
  project: Project | null;
  onProjectCreated: (project: Project) => void;
}

export function SettingsScreen({ session, project, onProjectCreated }: SettingsScreenProps) {
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

      <CreateProjectForm onCreated={onProjectCreated} />
      <SourceMapUpload project={project} />
      <GitHubConnect project={project} />
      <LogExport project={project} />
      <ApiTokenSection project={project} />

      <p style={{ fontSize: 13, color: "var(--fg3)", marginTop: 16, maxWidth: 480 }}>
        Member management, project settings and billing are not part of this workspace yet.
      </p>
    </div>
  );
}
