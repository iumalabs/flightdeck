import { EmptyState } from "../components/EmptyState.tsx";

export function ReleasesScreen() {
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
        Releases
      </h1>
      <EmptyState
        title="No releases yet"
        body="Tell FlightDeck about a deploy and adoption, crash-free rate and regressions will show up here."
      />
    </div>
  );
}
