import { EmptyState } from "../components/EmptyState.tsx";

export function LogsScreen() {
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
        Logs
      </h1>
      <EmptyState
        title="No logs yet"
        body="Structured logs from your services will show up here as a live, searchable stream."
      />
    </div>
  );
}
