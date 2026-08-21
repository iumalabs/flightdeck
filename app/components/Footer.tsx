export interface FooterProps {
  navigate: (path: string) => void;
}

const LINKS: Array<{ label: string; path: string }> = [
  { label: "Product", path: "/product" },
  { label: "Docs", path: "/docs" },
  { label: "Self-hosting", path: "/self-hosting" },
  { label: "Changelog", path: "/changelog" },
];

export function Footer({ navigate }: FooterProps) {
  return (
    <div style={{ borderTop: "1px solid var(--line)", background: "var(--panel)" }}>
      <div
        style={{
          maxWidth: 1140,
          margin: "0 auto",
          padding: "26px 28px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg3)" }}>
          © 2026 IUMA Labs · FlightDeck
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg3)" }}>
          flightdeck.iuma.dev
        </span>
        <nav
          aria-label="Footer"
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 18,
            fontSize: 13,
            color: "var(--fg2)",
          }}
        >
          {LINKS.map((link) => (
            <span
              key={link.path}
              onClick={() => navigate(link.path)}
              style={{ cursor: "pointer" }}
            >
              {link.label}
            </span>
          ))}
          <a href="https://github.com/iumalabs/flightdeck" style={{ color: "var(--fg2)" }}>
            GitHub
          </a>
        </nav>
      </div>
    </div>
  );
}
