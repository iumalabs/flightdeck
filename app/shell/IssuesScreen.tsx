import { EmptyState } from "../components/EmptyState.tsx";

export function IssuesScreen() {
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
        Issues
      </h1>
      <EmptyState
        title="No issues yet"
        body="Install an SDK to get started — errors will show up here, grouped and with full stack traces."
      />
    </div>
  );
}
