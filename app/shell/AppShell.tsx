import { useState } from "react";
import type { Session } from "../lib/use-session.ts";

export interface AppShellProps {
  session: Session;
  signOut: () => void;
  navigate: (path: string) => void;
}

interface NavItem {
  screen: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { screen: "overview", label: "Overview" },
      { screen: "issues", label: "Issues" },
      { screen: "traces", label: "Traces" },
      { screen: "logs", label: "Logs" },
    ],
  },
  {
    label: "Ship",
    items: [
      { screen: "releases", label: "Releases" },
      { screen: "uptime", label: "Uptime" },
    ],
  },
  {
    label: "Respond",
    items: [
      { screen: "feedback", label: "Feedback" },
      { screen: "alerts", label: "Alerts" },
    ],
  },
];

const FOOTER_ITEMS: NavItem[] = [
  { screen: "settings", label: "Settings" },
  { screen: "setup", label: "Install SDK" },
];

export function AppShell({ session, signOut, navigate }: AppShellProps) {
  const [screen, setScreen] = useState("overview");

  const initials = session.email.slice(0, 2).toUpperCase();

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", color: "var(--fg)" }}>
      <div
        style={{
          width: 228,
          flex: "none",
          borderRight: "1px solid var(--line)",
          background: "var(--panel)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          onClick={() => navigate("/")}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: 16, cursor: "pointer" }}
        >
          <svg width="22" height="22" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <circle cx="32" cy="32" r="24" stroke="#B8F135" strokeWidth="6" />
            <path d="M14 39H50" stroke="#B8F135" strokeWidth="6" strokeLinecap="round" />
            <path d="M32 18L38.5 28H25.5L32 18Z" fill="#B8F135" />
          </svg>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>
            FlightDeck
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--fg4)",
                  padding: "6px 10px",
                }}
              >
                {group.label}
              </div>
              {group.items.map((item) => (
                <div
                  key={item.screen}
                  onClick={() => setScreen(item.screen)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    fontSize: 13.5,
                    cursor: "pointer",
                    color: screen === item.screen ? "var(--accent)" : "var(--fg2)",
                    background: screen === item.screen ? "rgba(184,241,53,.08)" : "transparent",
                  }}
                >
                  {item.label}
                </div>
              ))}
            </div>
          ))}

          <div style={{ borderTop: "1px solid var(--line2)", marginTop: 8, paddingTop: 8 }}>
            {FOOTER_ITEMS.map((item) => (
              <div
                key={item.screen}
                onClick={() => setScreen(item.screen)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 13.5,
                  cursor: "pointer",
                  color: screen === item.screen ? "var(--accent)" : "var(--fg2)",
                  background: screen === item.screen ? "rgba(184,241,53,.08)" : "transparent",
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--chip)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              flex: "none",
            }}
          >
            {initials}
          </div>
          <span
            style={{
              fontSize: 12.5,
              color: "var(--fg2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {session.email}
          </span>
          <span
            onClick={signOut}
            title="Sign out"
            style={{ marginLeft: "auto", cursor: "pointer", color: "var(--fg3)", fontSize: 12.5 }}
          >
            Sign out
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 32 }}>
        {screen === "overview"
          ? (
            <div>
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 28,
                  fontWeight: 600,
                  margin: "0 0 8px",
                }}
              >
                Welcome, {session.email}
              </h1>
              <p style={{ color: "var(--fg2)", fontSize: 14 }}>
                Nothing here yet — install an SDK to start seeing errors, traces and logs.
              </p>
            </div>
          )
          : (
            <div style={{ color: "var(--fg2)", fontSize: 14 }}>
              No data yet for "{screen}".
            </div>
          )}
      </div>
    </div>
  );
}
