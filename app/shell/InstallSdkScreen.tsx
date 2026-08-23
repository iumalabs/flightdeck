export interface InstallSdkScreenProps {
  project: { name: string; dsn: string } | null;
}

// issues/24 — this used to hardcode an illustrative, non-functional DSN even though a real one
// already existed for the demo project; the DSN's public key is meant to be embedded in
// client-side SDK code, so there's no reason to hide it here the way a real secret (API token, S3
// credential) would be.
export function InstallSdkScreen({ project }: InstallSdkScreenProps) {
  const snippet = `import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: '${project ? project.dsn : "<create a project in Settings to get your DSN>"}',
  environment: 'production',
  release: process.env.GIT_SHA,
  tracesSampleRate: 0.2,
});`;

  return (
    <div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          fontWeight: 600,
          margin: "0 0 8px",
        }}
      >
        Install SDK
      </h1>
      <p style={{ fontSize: 14, color: "var(--fg2)", margin: "0 0 20px", maxWidth: 560 }}>
        {project
          ? (
            <>
              Point an existing Sentry SDK at your <strong>{project.name}</strong>{" "}
              DSN — nothing else in your code changes.
            </>
          )
          : "Create a project in Settings to get a real DSN."}
      </p>
      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--code-bg)",
          padding: 18,
          maxWidth: 560,
          overflowX: "auto",
        }}
      >
        <pre
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.7,
            color: "var(--fg2)",
          }}
        >
          {snippet}
        </pre>
      </div>
    </div>
  );
}
