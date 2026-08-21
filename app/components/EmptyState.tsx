export interface EmptyStateProps {
  title: string;
  body: string;
}

export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <div
      style={{
        border: "1px dashed var(--line)",
        borderRadius: 10,
        padding: "48px 32px",
        textAlign: "center",
        maxWidth: 480,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--fg2)" }}>{body}</div>
    </div>
  );
}
