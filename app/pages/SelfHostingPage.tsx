interface Deployment {
  name: string;
  body: string;
  spec: string;
}

const DEPLOYMENTS: Deployment[] = [
  {
    name: "Docker Compose",
    body:
      "One app container plus Postgres and MinIO. The right choice for a single VM and a few million events a month.",
    spec: "2 vCPU · 4 GB RAM · 50 GB disk",
  },
  {
    name: "Kubernetes",
    body:
      "Helm chart with separate ingest and web deployments, HPA on ingest lag, and a job for migrations.",
    spec: "helm repo add flightdeck https://charts.iuma.dev",
  },
  {
    name: "Cloudflare",
    body:
      "Workers for ingest, D1 for metadata, R2 for payloads and Access for auth. No servers to patch.",
    spec: "wrangler deploy · free tier friendly",
  },
];

const COMPOSE = `services:
  flightdeck:
    image: ghcr.io/iumalabs/flightdeck:0.1.0
    environment:
      FD_DATABASE_URL: postgres://fd:fd@db:5432/fd
      FD_STORAGE_URL: s3://minio:9000/flightdeck
      FD_PUBLIC_URL: https://flightdeck.iuma.dev
    ports: ["8080:8080"]
    depends_on: [db, minio]

  db:
    image: postgres:17-alpine
    volumes: ["pgdata:/var/lib/postgresql/data"]`;

const OPS = `# upgrade (migrations run on boot, forward-only)
docker compose pull && docker compose up -d

# backup: Postgres holds metadata, object storage holds payloads
pg_dump $FD_DATABASE_URL | zstd > fd-$(date +%F).sql.zst

# retention is enforced by a nightly job
fd maintenance prune --events 90d --logs 30d --traces 14d`;

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
    example: "yugai.cloudflareaccess.com",
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
          One binary plus Postgres and object storage. No Kafka, no Zookeeper, no twelve-service
          compose file.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          marginBottom: 36,
        }}
      >
        {DEPLOYMENTS.map((d) => (
          <div key={d.name} style={{ background: "var(--panel)", padding: 24, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "-.02em",
                marginBottom: 6,
              }}
            >
              {d.name}
            </div>
            <div
              style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--fg2)", marginBottom: 14 }}
            >
              {d.body}
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
              {d.spec}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 36 }}>
        <div
          style={{
            border: "1px solid var(--line)",
            background: "var(--code-bg)",
            padding: 18,
            overflowX: "auto",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--fg3)",
              marginBottom: 12,
            }}
          >
            docker-compose.yml
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: 1.7,
              color: "var(--fg2)",
            }}
          >{COMPOSE}</pre>
        </div>
        <div
          style={{
            border: "1px solid var(--line)",
            background: "var(--code-bg)",
            padding: 18,
            overflowX: "auto",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--fg3)",
              marginBottom: 12,
            }}
          >
            Upgrade &amp; backup
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: 1.7,
              color: "var(--fg2)",
            }}
          >{OPS}</pre>
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
