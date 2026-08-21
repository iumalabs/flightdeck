import { EmptyState } from "../components/EmptyState.tsx";

export function TracesScreen() {
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
        Traces
      </h1>
      <EmptyState
        title="No traces yet"
        body="Once your SDK reports spans, distributed traces will appear here as waterfalls across services."
      />
    </div>
  );
}
