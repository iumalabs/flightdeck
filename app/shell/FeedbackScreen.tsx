import { EmptyState } from "../components/EmptyState.tsx";

export function FeedbackScreen() {
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
        Feedback
      </h1>
      <EmptyState
        title="No feedback yet"
        body="Drop the feedback widget into your app and user messages will land here, linked to the event that triggered them."
      />
    </div>
  );
}
