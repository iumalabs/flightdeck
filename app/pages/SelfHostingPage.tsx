interface Deployment {
  name: string;
  body: string;
  spec: string;
}

const DEPLOYMENT: Deployment = {
  name: "Cloudflare",
  body:
    "Workers for ingest, D1 for metadata, R2 for payloads and Access for auth. No servers to patch.",
  spec: "wrangler deploy · free tier friendly",
};

interface EnvVar {
  key: string;
  example: string;
  note: string;
}

const ENV_VARS: EnvVar[] = [
  {
    key: "FD_DATABASE_URL",
    example: "postgres://…",
    note: "Postgres 15+. Metadata, issues, users.",
  },
  {
    key: "FD_STORAGE_URL",
    example: "s3://bucket",
    note: "Any S3-compatible store for event payloads and source maps.",
  },
  {
    key: "FD_PUBLIC_URL",
    example: "https://…",
    note: "Used in DSNs, links in alerts and OIDC audience.",
  },
  {
    key: "FD_ACCESS_TEAM",
    example: "your-team.cloudflareaccess.com",
    note: "Cloudflare Access team domain; enables JWT verification.",
  },
  {
    key: "FD_ACCESS_AUD",
    example: "flightdeck.iuma.dev/login",
    note: "Expected audience claim, verified at the /login bounce path.",
  },
  {
    key: "FD_INGEST_RATE_LIMIT",
    example: "5000/min",
    note: "Per-DSN soft limit before events are sampled away.",
  },
  { key: "FD_RETENTION_EVENTS", example: "90d", note: "Overridable per project in Settings." },
];

export function SelfHostingPage() {
  return (
    <div style={{ maxWidth: 1140, margin: "0 auto", padding: "60px 28px 88px" }}>
      <div style={{ maxWidth: 640, marginBottom: 40 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--accent)",
            marginBottom: 16,
          }}
        >
          Self-hosting
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-.035em",
            lineHeight: 1.05,
            margin: "0 0 16px",
          }}
        >
          Your data, your infrastructure
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
          Deploy FlightDeck into your own Cloudflare account. No cluster to run, no image to pull —
          just Workers, D1 and R2.
        </p>
      </div>

      <div
        style={{
          maxWidth: 420,
          margin: "0 auto 36px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          padding: 28,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-.02em",
            marginBottom: 8,
          }}
        >
          {DEPLOYMENT.name}
        </div>
        <div
          style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--fg2)", marginBottom: 16 }}
        >
          {DEPLOYMENT.body}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--fg3)",
            borderTop: "1px solid var(--line2)",
            paddingTop: 12,
          }}
        >
          {DEPLOYMENT.spec}
        </div>
      </div>

      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: "-.03em",
          margin: "0 0 16px",
        }}
      >
        Environment
      </h2>
      <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
        {ENV_VARS.map((e) => (
          <div
            key={e.key}
            style={{
              display: "flex",
              gap: 18,
              padding: "12px 18px",
              borderBottom: "1px solid var(--line2)",
              alignItems: "baseline",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                width: 230,
                flex: "none",
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: "var(--accent)",
              }}
            >
              {e.key}
            </span>
            <span
              style={{
                width: 200,
                flex: "none",
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: "var(--fg2)",
              }}
            >
              {e.example}
            </span>
            <span style={{ flex: 1, minWidth: 180, fontSize: 13, color: "var(--fg3)" }}>
              {e.note}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
