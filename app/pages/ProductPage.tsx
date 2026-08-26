const TEAL = "#4FD1C5";
const AMBER = "#FFC53D";

interface Pillar {
  title: string;
  meta: string;
  bullets: string[];
}

const PILLARS: Pillar[] = [
  {
    title: "Error monitoring",
    meta: "issues · grouping · symbolication",
    bullets: [
      "Fingerprinting by exception type, culprit frame and normalised message.",
      "Source maps uploaded from CI; frames resolve to app code, vendor frames collapse by default.",
      "Local variables, breadcrumbs, request context and suspect commit derived from the release's diff.",
    ],
  },
  {
    title: "Distributed tracing",
    meta: "spans · p50/p95 · budgets",
    bullets: [
      "W3C traceparent propagation across browser, backend and workers — one waterfall per request.",
      "Per-transaction p50/p95 duration, grouped by operation over a trailing window.",
      "Errors are attached to the span that produced them, so a trace opens straight into the stack trace.",
    ],
  },
  {
    title: "Structured logs",
    meta: "stream · search · retention",
    bullets: [
      "Ingest over the same envelope endpoint; attributes stay typed, not stringified.",
      "Live tail with level and free-text filters; every line carries its trace id.",
      "7-day hot retention by default, with revocable, on-demand export to S3-compatible storage.",
    ],
  },
  {
    title: "Releases",
    meta: "adoption · crash-free · regressions",
    bullets: [
      'A release is created by your deploy step; issues resolve "in the next release" and reopen on regression.',
      "Adoption and crash-free session rate per version, split by environment.",
      "Commit association via GitHub, so a new issue names the likely author.",
    ],
  },
  {
    title: "Uptime",
    meta: "http & tcp checks",
    bullets: [
      "HTTP and TCP checks on a configurable interval, with assertions on status, body and latency.",
      "A configurable run of consecutive failures opens an incident; consecutive recoveries close it.",
      "An optional per-check webhook fires on every incident open and resolve.",
    ],
  },
  {
    title: "User feedback",
    meta: "widget · crash reports",
    bullets: [
      "A drop-in widget that links a message to the user's last event, so it lands on the right issue.",
      "Crash-report dialog matches the real SDK's showReportDialog() contract, so it works unmodified.",
      "Both paths converge on the same feedback record, cross-linked from the issue it names.",
    ],
  },
];

interface CompareRow {
  name: string;
  sentry: string;
  glitchtip: string;
  fd: string;
  color: string;
}

const COMPARE: CompareRow[] = [
  {
    name: "Sentry SDK / DSN compatible",
    sentry: "native",
    glitchtip: "yes",
    fd: "yes",
    color: TEAL,
  },
  { name: "Distributed tracing", sentry: "yes", glitchtip: "partial", fd: "yes", color: TEAL },
  { name: "Structured logs", sentry: "yes", glitchtip: "no", fd: "yes", color: TEAL },
  { name: "Uptime monitoring", sentry: "yes", glitchtip: "yes", fd: "yes", color: TEAL },
  { name: "Session replay", sentry: "yes", glitchtip: "no", fd: "on the roadmap", color: AMBER },
  { name: "Profiling", sentry: "yes", glitchtip: "no", fd: "not planned", color: "#8A8A82" },
  { name: "Single-binary self-host", sentry: "no", glitchtip: "yes", fd: "yes", color: TEAL },
];

export function ProductPage() {
  return (
    <div style={{ maxWidth: 1140, margin: "0 auto", padding: "60px 28px 88px" }}>
      <div style={{ maxWidth: 640, marginBottom: 44 }}>
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
          Product
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
          Six instruments, one signal chain
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
          Every event carries the same identifiers — trace, release, user, environment — so an
          alert, a log line and a stack frame are always one click apart.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          marginBottom: 44,
        }}
      >
        {PILLARS.map((p) => (
          <div
            key={p.title}
            style={{
              background: "var(--panel)",
              padding: 26,
              display: "flex",
              gap: 28,
              flexWrap: "wrap",
            }}
          >
            <div style={{ width: 240, flex: "none", minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 19,
                  fontWeight: 600,
                  letterSpacing: "-.02em",
                  marginBottom: 7,
                }}
              >
                {p.title}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg3)" }}>
                {p.meta}
              </div>
            </div>
            <div
              style={{
                flex: "1 1 320px",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 9,
              }}
            >
              {p.bullets.map((b) => (
                <div
                  key={b}
                  style={{
                    display: "flex",
                    gap: 10,
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: "var(--fg2)",
                  }}
                >
                  <span style={{ color: "var(--accent)", flex: "none" }}>—</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "-.03em",
          margin: "0 0 18px",
        }}
      >
        Coming from Sentry or GlitchTip
      </h2>
      <div style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
        <div
          style={{
            display: "flex",
            gap: 14,
            padding: "12px 18px",
            borderBottom: "1px solid var(--line)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: "var(--fg3)",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>Capability</span>
          <span style={{ width: 110, flex: "none", textAlign: "center" }}>Sentry</span>
          <span style={{ width: 110, flex: "none", textAlign: "center" }}>GlitchTip</span>
          <span style={{ width: 110, flex: "none", textAlign: "center" }}>FlightDeck</span>
        </div>
        {COMPARE.map((c) => (
          <div
            key={c.name}
            style={{
              display: "flex",
              gap: 14,
              padding: "12px 18px",
              borderBottom: "1px solid var(--line2)",
              alignItems: "center",
            }}
          >
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{c.name}</span>
            <span
              style={{
                width: 110,
                flex: "none",
                textAlign: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: "var(--fg3)",
              }}
            >
              {c.sentry}
            </span>
            <span
              style={{
                width: 110,
                flex: "none",
                textAlign: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: "var(--fg3)",
              }}
            >
              {c.glitchtip}
            </span>
            <span
              style={{
                width: 110,
                flex: "none",
                textAlign: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: c.color,
              }}
            >
              {c.fd}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
