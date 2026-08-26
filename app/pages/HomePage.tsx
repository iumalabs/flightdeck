const RED = "#FF4D4D";
const ORANGE = "#FF7847";
const AMBER = "#FFC53D";

interface MockRow {
  title: string;
  culprit: string;
  events: string;
  color: string;
}

const ROWS: MockRow[] = [
  {
    title: "TypeError: Cannot read properties of undefined",
    culprit: "CartSummary.tsx in useCheckout",
    events: "12.4k",
    color: ORANGE,
  },
  {
    title: "OperationalError: too many connections",
    culprit: "db/pool.py in acquire",
    events: "3.9k",
    color: RED,
  },
  {
    title: "TimeoutError: Redis command timed out",
    culprit: "cache/client.ts in get",
    events: "1.8k",
    color: ORANGE,
  },
  {
    title: "panic: index out of range [3] with length 3",
    culprit: "ingest/batch.go in flush",
    events: "946",
    color: RED,
  },
  {
    title: "ChunkLoadError: Loading chunk 42 failed",
    culprit: "app/router.ts in load",
    events: "287",
    color: AMBER,
  },
];

function spark(seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    out.push(Math.round((Math.abs(Math.sin(seed * 1.9 + i * 0.87)) * 0.78 + 0.16) * 100));
  }
  return out;
}

const SNIPPET = `  Sentry.init({
-   dsn: 'https://abc123@o1.ingest.sentry.io/42',
+   dsn: 'https://a91f3ce4c1@flightdeck.iuma.dev/12',
    environment: 'production',
    release: 'web@2026.8.3',
    tracesSampleRate: 0.2,
  });`;

const FEATURES = [
  {
    title: "Error monitoring",
    body:
      "Grouped issues with full stack traces, local variables, breadcrumbs and suspect commits.",
    icon: <path d="M12 3.5 21 19H3zM12 10v4M12 16.5v.5" />,
  },
  {
    title: "Distributed tracing",
    body: "Span waterfalls across services, p50/p95 per transaction and latency budgets.",
    icon: <path d="M4 5h11M4 10h16M8 15h12M4 20h9" />,
  },
  {
    title: "Structured logs",
    body: "A live stream from every service, searchable and linked to the trace that produced it.",
    icon: <path d="M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11" />,
  },
  {
    title: "Releases",
    body: "Adoption, crash-free sessions and regressions per version, wired to your deploys.",
    icon: <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5zM4 8.5 12 13l8-4.5M12 13v7" />,
  },
  {
    title: "Uptime",
    body: "HTTP and TCP checks every 60 seconds, with incident-aware alerting.",
    icon: <path d="M3 12h3l2.5-6 3 12 3-8 2 4h4" />,
  },
  {
    title: "User feedback",
    body: "A widget that attaches the user's last event and breadcrumbs to every message.",
    icon: <path d="M4 5h16v11H9l-5 4z" />,
  },
];

export interface HomePageProps {
  onLoginClick: () => void;
  navigate: (path: string) => void;
  loggedIn: boolean;
}

export function HomePage({ onLoginClick, navigate, loggedIn }: HomePageProps) {
  return (
    <div>
      <div
        style={{
          maxWidth: 1140,
          margin: "0 auto",
          padding: "88px 28px 72px",
          display: "grid",
          gridTemplateColumns: "minmax(0,1.05fr) minmax(0,.95fr)",
          gap: 56,
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 10px",
              border: "1px solid rgba(184,241,53,.3)",
              color: "var(--accent)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              marginBottom: 26,
            }}
          >
            <span
              style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }}
            />
            Sentry-SDK compatible
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 64,
              lineHeight: 0.96,
              letterSpacing: "-.04em",
              margin: "0 0 20px",
            }}
          >
            Every instrument.
            <br />
            One panel.
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.6,
              color: "var(--fg2)",
              maxWidth: 520,
              margin: "0 0 30px",
            }}
          >
            Errors, traces, logs, releases, uptime and user feedback for the whole stack. Point an
            existing Sentry SDK at a new DSN and you are already flying on instruments.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span
              onClick={onLoginClick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "13px 20px",
                background: "var(--accent)",
                color: "var(--accent-fg)",
                fontWeight: 600,
                fontSize: 14.5,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0B0B0C"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 11V8a6 6 0 0 1 12 0v3" />
                <rect x="4" y="11" width="16" height="9" rx="2" />
              </svg>
              {loggedIn ? "Open the deck" : "Log in with Cloudflare Access"}
            </span>
            <span
              onClick={() => navigate("/docs")}
              style={{
                padding: "13px 18px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 14.5,
                cursor: "pointer",
                color: "var(--fg2)",
              }}
            >
              Read the docs
            </span>
          </div>
          <div
            style={{
              marginTop: 18,
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--fg3)",
            }}
          >
            SSO only · Cloudflare Access (OIDC) · no passwords stored
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              border: "1px solid var(--line)",
              background: "var(--panel)",
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "0 30px 70px rgba(0,0,0,.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 14px",
                borderBottom: "1px solid var(--line)",
                background: "#0E0E10",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FF4D4D" }} />
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FFC53D" }} />
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#4FD1C5" }} />
              <span
                style={{
                  marginLeft: 10,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--fg3)",
                }}
              >
                flightdeck.iuma.dev/web-app/issues
              </span>
            </div>
            {ROWS.map((row, i) => (
              <div
                key={row.title}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "11px 14px",
                  borderBottom: "1px solid var(--line2)",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    flex: "none",
                    background: row.color,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {row.title}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--fg3)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {row.culprit}
                  </span>
                </span>
                <span
                  style={{
                    width: 58,
                    flex: "none",
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 1,
                    height: 20,
                  }}
                >
                  {spark(i + 1).map((h, j) => (
                    <span
                      key={j}
                      style={{ flex: 1, background: row.color, height: `${h}%`, minHeight: 2 }}
                    />
                  ))}
                </span>
                <span
                  style={{
                    width: 46,
                    textAlign: "right",
                    flex: "none",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                >
                  {row.events}
                </span>
              </div>
            ))}
            <div
              style={{
                padding: "10px 14px",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--fg4)",
              }}
            >
              ingest 42 ms · 48.2k events / 24h
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 28px 88px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,minmax(0,1fr))",
            gap: 1,
            background: "var(--line)",
            border: "1px solid var(--line)",
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
              style={{ background: "var(--panel)", padding: "26px 24px", minWidth: 0 }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--accent)", display: "block", marginBottom: 14 }}
                aria-hidden="true"
              >
                {f.icon}
              </svg>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: "-.02em",
                  marginBottom: 8,
                }}
              >
                {f.title}
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--fg2)" }}>{f.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          maxWidth: 1140,
          margin: "0 auto",
          padding: "0 28px 96px",
          display: "grid",
          gridTemplateColumns: ".9fr 1.1fr",
          gap: 48,
          alignItems: "center",
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 34,
              fontWeight: 600,
              letterSpacing: "-.03em",
              margin: "0 0 14px",
              lineHeight: 1.1,
            }}
          >
            Migration is one line
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--fg2)", margin: "0 0 20px" }}>
            FlightDeck speaks the Sentry envelope protocol, so your existing SDKs, source maps,
            releases and CI integrations keep working. Change the DSN, keep the code.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 11,
              fontSize: 14,
              color: "var(--fg2)",
            }}
          >
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ color: "var(--accent)" }}>✓</span>Same SDKs: JavaScript, Python, Go,
              Ruby, PHP, Java, .NET, iOS, Android
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ color: "var(--accent)" }}>✓</span>Same endpoints: /store/, /envelope/,
              minidumps, source maps
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ color: "var(--accent)" }}>✓</span>Self-host on your own infra, or run
              it on Cloudflare
            </div>
          </div>
        </div>
        <div
          style={{
            border: "1px solid var(--line)",
            background: "var(--code-bg)",
            padding: 22,
            overflowX: "auto",
          }}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.75,
              color: "var(--fg2)",
            }}
          >
            {SNIPPET}
          </pre>
        </div>
      </div>
    </div>
  );
}
