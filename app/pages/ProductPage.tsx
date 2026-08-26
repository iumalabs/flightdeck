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
      "Source maps, dSYM, ProGuard and Go build IDs uploaded from CI; frames resolve to app code, vendor frames collapse by default.",
      "Local variables, breadcrumbs, request context and suspect commit derived from the release's diff.",
    ],
  },
  {
    title: "Distributed tracing",
    meta: "spans · p50/p95 · budgets",
    bullets: [
      "W3C traceparent propagation across browser, backend and workers — one waterfall per request.",
      "Per-transaction p50/p75/p95, throughput and failure rate, with a latency budget that can page you.",
      "Errors are attached to the span that produced them, so a trace opens straight into the stack trace.",
    ],
  },
  {
    title: "Structured logs",
    meta: "stream · search · retention",
    bullets: [
      "Ingest over the same envelope endpoint or via OTLP; attributes stay typed, not stringified.",
      "Live tail with level and free-text filters; every line carries its trace id.",
      "30-day hot retention by default, with continuous export to S3-compatible storage.",
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
    meta: "http checks · 4 regions",
    bullets: [
      "HTTP and TCP checks every 60 seconds from four regions, with assertions on status, body and latency.",
      "Two consecutive failures open an incident; recovery closes it and annotates the timeline.",
      "Check history is a first-class series — the same alert rules apply as to events.",
    ],
  },
  {
    title: "User feedback",
    meta: "widget · crash reports",
    bullets: [
      "A drop-in widget that attaches the user's last event, breadcrumbs and screenshot to the message.",
      "Crash-report dialog after an unhandled error, so the report lands on the right issue.",
      "Replies go out through your existing support inbox — FlightDeck keeps the linkage, not the mailbox.",
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
  { name: "Self-hostable", sentry: "no", glitchtip: "yes", fd: "yes", color: TEAL },
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
