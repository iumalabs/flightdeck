const LIME = "#B8F135";

interface ChangelogItem {
  tag: string;
  color: string;
  border: string;
  text: string;
}

interface ChangelogEntry {
  version: string;
  date: string;
  channel: string;
  channelColor: string;
  items: ChangelogItem[];
}

// Honest, product-facing entries only — see 001-landing-access-login/spec.md's Assumptions: no
// fabricated version history, unlike the design mockup's illustrative multi-release changelog.
// Each entry below is grounded in a real shipped module's spec.md; internal-only commits (CI
// fixes, deploy isolation, API-path versioning, retroactive release-note corrections) are left
// off since they carry no user-visible meaning.
const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.13.5",
    date: "26 Aug 2026",
    channel: "patch",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text:
          'Settings → Connect GitHub now verifies the installation ID and owner/repo against GitHub\'s API before saving, instead of accepting fabricated input as a false "connected" success.',
      },
    ],
  },
  {
    version: "0.13.2",
    date: "26 Aug 2026",
    channel: "patch",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text: "The Traces waterfall now renders correctly against the real API's field names.",
      },
    ],
  },
  {
    version: "0.13.1",
    date: "25 Aug 2026",
    channel: "patch",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text:
          "Automatic uptime-check seeding no longer treats an SPA's catch-all response as a real health endpoint.",
      },
    ],
  },
  {
    version: "0.13.0",
    date: "25 Aug 2026",
    channel: "minor",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "Creating a project can seed a few default uptime checks (root + health endpoint) automatically from its base URL.",
      },
    ],
  },
  {
    version: "0.12.0",
    date: "25 Aug 2026",
    channel: "minor",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "DSN project ids are now plain numbers instead of UUIDs, so an unmodified @sentry/* SDK — whose DSN parser rejects non-numeric project ids — can point straight at FlightDeck.",
      },
    ],
  },
  {
    version: "0.11.2",
    date: "25 Aug 2026",
    channel: "patch",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text: "The Logs screen's search toolbar no longer overflows at narrow browser widths.",
      },
    ],
  },
  {
    version: "0.11.1",
    date: "25 Aug 2026",
    channel: "patch",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text:
          "Signed-in users can now reach the public marketing pages (Docs, Changelog, Product, Self-hosting) and deep-link or refresh into a specific app-shell screen.",
      },
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text:
          "An uptime check targeting FlightDeck's own domain no longer false-positives as down.",
      },
    ],
  },
  {
    version: "0.11.0",
    date: "24 Aug 2026",
    channel: "minor",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text: "The crash-report dialog now prefills name and email from query params.",
      },
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text:
          "Uptime incident evaluation is now correctly wired up, so the Alerts screen reflects real incidents instead of always showing empty.",
      },
    ],
  },
  {
    version: "0.10.0",
    date: "24 Aug 2026",
    channel: "minor",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "Release routes are now project-scoped, and adoption percentage is windowed to recent sessions instead of all-time.",
      },
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text:
          "Issue detail now distinguishes retention-pruned event data from data that was never recorded.",
      },
    ],
  },
  {
    version: "0.9.1",
    date: "23 Aug 2026",
    channel: "patch",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text:
          "Ingest now accepts the trailing-slash envelope path (/api/{project_id}/envelope/) real Sentry SDKs send.",
      },
    ],
  },
  {
    version: "0.9.0",
    date: "23 Aug 2026",
    channel: "patch",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "fixed",
        color: "#F1A93C",
        border: "rgba(241,169,60,.4)",
        text:
          "Dashboard selects use a themed dropdown instead of the native browser popup, fixing readability in dark mode.",
      },
    ],
  },
  {
    version: "0.7.0",
    date: "23 Aug 2026",
    channel: "minor",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "Overview shows real per-pillar counts, and Install SDK surfaces each project's real DSN.",
      },
    ],
  },
  {
    version: "0.6.0",
    date: "23 Aug 2026",
    channel: "minor",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "Multi-project support — create additional projects and scope the dashboard to each one.",
      },
    ],
  },
  {
    version: "0.5.0",
    date: "22 Aug 2026",
    channel: "minor",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text: "Structured logs — live tail, search, and S3-compatible export.",
      },
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "Releases — sentry-cli-compatible release/source-map upload, adoption and crash-free rates, regression detection.",
      },
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text: "Uptime monitoring — HTTP/TCP checks with incident-aware alerting.",
      },
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "User feedback — drop-in widget and crash-report dialog, linked back to the originating event.",
      },
    ],
  },
  {
    version: "0.4.0",
    date: "22 Aug 2026",
    channel: "minor",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "Distributed tracing — span waterfalls, p50/p95 per transaction, and trace-to-error linkage.",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "21 Aug 2026",
    channel: "minor",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "Error monitoring — Sentry-SDK-compatible ingest, issue grouping, source maps, and suspect commits.",
      },
    ],
  },
  {
    version: "0.1.0",
    date: "21 Aug 2026",
    channel: "initial release",
    channelColor: "#8A8A82",
    items: [
      {
        tag: "added",
        color: LIME,
        border: "rgba(184,241,53,.4)",
        text:
          "Marketing site, Cloudflare Access sign-in, and the authenticated app-shell skeleton.",
      },
    ],
  },
];

export function ChangelogPage() {
  return (
    <div style={{ maxWidth: 840, margin: "0 auto", padding: "60px 28px 88px" }}>
      <div style={{ marginBottom: 40 }}>
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
          Changelog
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-.035em",
            lineHeight: 1.05,
            margin: "0 0 14px",
          }}
        >
          What shipped
        </h1>
        <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
          Releases are cut from main and rolled out to hosted first, then tagged for self-hosting.
        </p>
      </div>
      {CHANGELOG.map((c) => (
        <div
          key={c.version}
          style={{
            display: "flex",
            gap: 28,
            padding: "26px 0",
            borderTop: "1px solid var(--line)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ width: 150, flex: "none" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                fontWeight: 500,
                marginBottom: 5,
              }}
            >
              {c.version}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg3)" }}>
              {c.date}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: c.channelColor,
                marginTop: 8,
              }}
            >
              {c.channel}
            </div>
          </div>
          <div
            style={{
              flex: "1 1 320px",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {c.items.map((i) => (
              <div key={i.text} style={{ display: "flex", gap: 11, alignItems: "baseline" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: i.color,
                    border: `1px solid ${i.border}`,
                    padding: "1px 6px",
                    flex: "none",
                    width: 74,
                    textAlign: "center",
                  }}
                >
                  {i.tag}
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.55, color: "var(--fg2)" }}>
                  {i.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
