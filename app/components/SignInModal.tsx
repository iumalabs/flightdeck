export interface SignInModalProps {
  open: boolean;
  onClose: () => void;
}

export function SignInModal({ open, onClose }: SignInModalProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(6,6,7,.72)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div onClick={onClose} style={{ position: "absolute", inset: 0 }} />
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 420,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: 30,
          boxShadow: "0 40px 90px rgba(0,0,0,.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 22 }}>
          <svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <circle cx="32" cy="32" r="24" stroke="#B8F135" strokeWidth="6" />
            <path d="M14 39H50" stroke="#B8F135" strokeWidth="6" strokeLinecap="round" />
            <path d="M32 18L38.5 28H25.5L32 18Z" fill="#B8F135" />
          </svg>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: "-.02em",
            }}
          >
            FlightDeck
          </span>
          <span
            onClick={onClose}
            style={{
              marginLeft: "auto",
              color: "var(--fg3)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </span>
        </div>

        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 23,
            fontWeight: 600,
            letterSpacing: "-.025em",
            margin: "0 0 8px",
          }}
        >
          Sign in
        </h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--fg2)", margin: "0 0 24px" }}>
          Access is granted by your organisation's Cloudflare Access policy. FlightDeck never sees a
          password.
        </p>

        {
          /* Real, full-page navigation to /login — the one path Cloudflare Access actually
            protects (research.md §1). Access intercepts this request, runs the IdP challenge, and
            forwards back to the Worker with a verifiable identity assertion. */
        }
        <a
          href="/login"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 11,
            padding: "14px 18px",
            background: "var(--accent)",
            color: "var(--accent-fg)",
            border: "1px solid var(--accent)",
            fontWeight: 600,
            fontSize: 14.5,
            borderRadius: 8,
          }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6.6 17.5h11.1a3.4 3.4 0 0 0 .3-6.8 5.4 5.4 0 0 0-10.2-1.6 3.9 3.9 0 0 0-1.2 8.4Z"
              fill="var(--accent-fg)"
            />
          </svg>
          Continue with Cloudflare Access
        </a>

        <div
          style={{
            marginTop: 24,
            paddingTop: 18,
            borderTop: "1px solid var(--line2)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--fg3)",
          }}
        >
          <div>idp · yugai.cloudflareaccess.com</div>
          <div>audience · flightdeck.iuma.dev/login</div>
          <div>token · Cf-Access-Jwt-Assertion (JWT, RS256)</div>
        </div>

        <div style={{ marginTop: 18, fontSize: 12, color: "var(--fg3)", lineHeight: 1.5 }}>
          No account? Ask an admin to add your email to the FlightDeck access policy.
        </div>
      </div>
    </div>
  );
}
