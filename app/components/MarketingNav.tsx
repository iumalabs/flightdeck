import type { CSSProperties } from "react";

export interface MarketingNavProps {
  pathname: string;
  navigate: (path: string) => void;
  loggedIn: boolean;
  sessionHint: string;
  onLoginClick: () => void;
}

const NAV_LINKS: Array<{ label: string; path: string }> = [
  { label: "Product", path: "/product" },
  { label: "Docs", path: "/docs" },
  { label: "Self-hosting", path: "/self-hosting" },
  { label: "Changelog", path: "/changelog" },
];

const wrapStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  backdropFilter: "blur(10px)",
  background: "rgba(11,11,12,.82)",
  borderBottom: "1px solid var(--line)",
};

const innerStyle: CSSProperties = {
  maxWidth: 1140,
  margin: "0 auto",
  padding: "14px 28px",
  display: "flex",
  alignItems: "center",
  gap: 14,
};

export function MarketingNav(
  { pathname, navigate, loggedIn, sessionHint, onLoginClick }: MarketingNavProps,
) {
  return (
    <div style={wrapStyle}>
      <div style={innerStyle}>
        <div
          onClick={() => navigate("/")}
          style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
        >
          <svg width="24" height="24" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <circle cx="32" cy="32" r="24" stroke="#B8F135" strokeWidth="6" />
            <path d="M14 39H50" stroke="#B8F135" strokeWidth="6" strokeLinecap="round" />
            <path d="M32 18L38.5 28H25.5L32 18Z" fill="#B8F135" />
          </svg>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: "-.02em",
            }}
          >
            FlightDeck
          </span>
        </div>

        <nav
          aria-label="Primary"
          style={{ display: "flex", gap: 20, marginLeft: 22, fontSize: 13.5 }}
        >
          {NAV_LINKS.map((link) => (
            <span
              key={link.path}
              onClick={() => navigate(link.path)}
              style={{
                cursor: "pointer",
                color: pathname === link.path ? "var(--accent)" : "var(--fg2)",
              }}
            >
              {link.label}
            </span>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {sessionHint && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "var(--fg3)",
                whiteSpace: "nowrap",
              }}
            >
              {sessionHint}
            </span>
          )}
          <span
            onClick={onLoginClick}
            style={{
              padding: "8px 15px",
              background: "var(--accent)",
              color: "var(--accent-fg)",
              fontWeight: 600,
              fontSize: 13,
              borderRadius: 7,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {loggedIn ? "Open app →" : "Log in"}
          </span>
        </div>
      </div>
    </div>
  );
}
