import { EmptyState } from "../components/EmptyState.tsx";

export function AlertsScreen() {
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
        Alerts
      </h1>
      <EmptyState
        title="No alert rules yet"
        body="Alert rules will show up here once your workspace has data to evaluate them against."
      />
    </div>
  );
}
