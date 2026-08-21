import { EmptyState } from "../components/EmptyState.tsx";

export function UptimeScreen() {
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
        Uptime
      </h1>
      <EmptyState
        title="No uptime checks yet"
        body="Add a check and FlightDeck will monitor it from four regions, every 60 seconds."
      />
    </div>
  );
}
