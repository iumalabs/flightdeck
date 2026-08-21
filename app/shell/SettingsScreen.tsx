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

      <p style={{ fontSize: 13, color: "var(--fg3)", marginTop: 16, maxWidth: 480 }}>
        Member management, project settings and billing are not part of this workspace yet.
      </p>
    </div>
  );
}
