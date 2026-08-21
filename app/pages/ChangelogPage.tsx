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

// A single, honest entry for this module — see spec.md's Assumptions: no fabricated version
// history, unlike the design mockup's illustrative multi-release changelog.
const CHANGELOG: ChangelogEntry[] = [
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
