import type { Session } from "../lib/use-session.ts";
import { EmptyState } from "../components/EmptyState.tsx";

export function OverviewScreen({ session }: { session: Session }) {
  return (
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
      <p style={{ color: "var(--fg2)", fontSize: 14, margin: "0 0 24px" }}>
        This workspace has no telemetry yet.
      </p>
      <EmptyState
        title="No data yet"
        body="Install an SDK to start seeing errors, traces, logs, releases and uptime checks here."
      />
    </div>
  );
}
