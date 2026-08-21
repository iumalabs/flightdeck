const SNIPPET = `import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: 'https://a91f3ce4c1@flightdeck.iuma.dev/12',
  environment: 'production',
  release: process.env.GIT_SHA,
  tracesSampleRate: 0.2,
});`;

export function InstallSdkScreen() {
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
        Point an existing Sentry SDK at your DSN — nothing else in your code changes. DSN issuance
        for real projects isn't wired up yet, so the value below is illustrative.
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
          {SNIPPET}
        </pre>
      </div>
    </div>
  );
}
