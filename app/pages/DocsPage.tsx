interface DocSection {
  id: string;
  title: string;
  body: string;
  code: string;
}

const DOC_NAV: Array<{ label: string; href: string }> = [
  { label: "Quickstart", href: "#quickstart" },
  { label: "DSN & endpoints", href: "#dsn" },
  { label: "Source maps", href: "#sourcemaps" },
  { label: "Releases & deploys", href: "#releases" },
  { label: "Alerts & webhooks", href: "#alerts" },
  { label: "Access control", href: "#access" },
];

const DOC_SECTIONS: DocSection[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    body:
      "Install the Sentry SDK for your platform as usual, then point it at your FlightDeck DSN. Nothing else in your code changes.",
    code: `import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: 'https://a91f3ce4c1@flightdeck.iuma.dev/12',
  environment: 'production',
  release: process.env.GIT_SHA,
  tracesSampleRate: 0.2,
});`,
  },
  {
    id: "dsn",
    title: "DSN & endpoints",
    body:
      "The DSN encodes the public key and the project id. Both the legacy store endpoint and the envelope endpoint are served; envelopes are preferred by all modern SDKs.",
    code: `POST /api/{project_id}/envelope/
POST /api/{project_id}/store/
POST /api/{project_id}/minidump/

X-Sentry-Auth: Sentry sentry_key={public_key}, sentry_version=7

# health
GET  /api/health   → 200 {"ingest":"ok","lag_ms":38}`,
  },
  {
    id: "sourcemaps",
    title: "Source maps",
    body:
      "Upload artifacts in CI, keyed by release. The FlightDeck CLI is API-compatible with sentry-cli, so an existing pipeline works after changing two environment variables.",
    code: `export FLIGHTDECK_URL=https://flightdeck.iuma.dev
export FLIGHTDECK_TOKEN=$CI_FLIGHTDECK_TOKEN

fd releases new web@$GIT_SHA
fd releases files web@$GIT_SHA upload-sourcemaps ./dist
fd releases finalize web@$GIT_SHA`,
  },
  {
    id: "releases",
    title: "Releases & deploys",
    body:
      "Tell FlightDeck when a version reaches an environment. Adoption, crash-free rate and regression detection all derive from this call.",
    code: `fd deploys new --release web@$GIT_SHA --env production

# resolve an issue in the next release
PUT /api/0/issues/{id}/  {"status":"resolvedInNextRelease"}`,
  },
  {
    id: "alerts",
    title: "Alerts & webhooks",
    body:
      "Rules are evaluated on the ingest stream. Outgoing webhooks are signed with HMAC-SHA256 over the raw body; verify before trusting.",
    code: `POST https://hooks.acme.io/flightdeck
X-FlightDeck-Signature: sha256=9f1a…

{
  "rule": "New issue in production",
  "issue": { "id": "FD-4F2", "type": "TypeError", "events": 1284 },
  "release": "web@2026.8.3",
  "url": "https://flightdeck.iuma.dev/web-app/issues/FD-4F2"
}`,
  },
  {
    id: "access",
    title: "Access control",
    body:
      "The dashboard sits behind Cloudflare Access — FlightDeck trusts the verified identity from an Access-gated login exchange and maps it to a member. Ingest endpoints stay public and are authenticated by the DSN key.",
    code: `# wrangler.jsonc / access policy
team  = "yugai.cloudflareaccess.com"
aud   = "<this application's Access AUD tag>"
rules = ["emails ending in @acme.io", "group: platform"]

# roles are derived from the identity's groups
owner | admin | member | read-only`,
  },
];

export function DocsPage() {
  return (
    <div
      style={{
        maxWidth: 1140,
        margin: "0 auto",
        padding: "44px 28px 88px",
        display: "flex",
        gap: 36,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          width: 200,
          flex: "none",
          position: "sticky",
          top: 88,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: "var(--fg4)",
            padding: "0 10px 10px",
          }}
        >
          Documentation
        </div>
        {DOC_NAV.map((d) => (
          <a
            key={d.href}
            href={d.href}
            style={{ padding: "7px 10px", borderRadius: 6, fontSize: 13.5, color: "var(--fg2)" }}
          >
            {d.label}
          </a>
        ))}
      </div>
      <div style={{ flex: "999 1 520px", minWidth: 0 }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 38,
            fontWeight: 600,
            letterSpacing: "-.035em",
            margin: "0 0 10px",
          }}
        >
          Docs
        </h1>
        <p
          style={{
            fontSize: 15.5,
            lineHeight: 1.6,
            color: "var(--fg2)",
            margin: "0 0 36px",
            maxWidth: 620,
          }}
        >
          Everything below assumes an existing Sentry SDK. If you are starting from zero, install
          the SDK for your platform first — the official instructions apply unchanged.
        </p>
        {DOC_SECTIONS.map((s) => (
          <div key={s.id} id={s.id} style={{ marginBottom: 38, scrollMarginTop: 86 }}>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-.025em",
                margin: "0 0 10px",
              }}
            >
              {s.title}
            </h2>
            <p
              style={{
                fontSize: 14.5,
                lineHeight: 1.65,
                color: "var(--fg2)",
                margin: "0 0 14px",
                maxWidth: 640,
              }}
            >
              {s.body}
            </p>
            <div
              style={{
                border: "1px solid var(--line)",
                background: "var(--code-bg)",
                padding: 16,
                overflowX: "auto",
              }}
            >
              <pre
                style={{
                  margin: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  lineHeight: 1.7,
                  color: "var(--fg2)",
                }}
              >{s.code}</pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
