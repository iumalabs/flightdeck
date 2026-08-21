import type { Session } from "../lib/use-session.ts";

export function SettingsScreen({ session }: { session: Session }) {
  return (
    <div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          fontWeight: 600,
          margin: "0 0 20px",
        }}
      >
        Settings
      </h1>
      <div style={{ border: "1px solid var(--line)", background: "var(--panel)", maxWidth: 480 }}>
        {[
          ["Email", session.email],
          ["Role", session.role],
          ["Identifier", session.sub],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              gap: 18,
              padding: "12px 18px",
              borderBottom: "1px solid var(--line2)",
            }}
          >
            <span style={{ width: 110, flex: "none", fontSize: 13, color: "var(--fg3)" }}>
              {label}
            </span>
            <span style={{ fontSize: 13.5, fontFamily: "var(--font-mono)" }}>{value}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 13, color: "var(--fg3)", marginTop: 16, maxWidth: 480 }}>
        Member management, project settings and billing are not part of this workspace yet.
      </p>
    </div>
  );
}
