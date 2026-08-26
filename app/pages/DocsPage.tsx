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
  { label: "Uptime webhooks", href: "#webhooks" },
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
      "The DSN encodes the public key and the project id. The only ingest endpoint is the Sentry envelope endpoint — FlightDeck speaks the envelope protocol exclusively; there is no legacy store or minidump endpoint. Auth travels in either the X-Sentry-Auth header or the sentry_key query parameter (both are checked when present, and must agree).",
    code: `POST /api/{project_id}/envelope
POST /api/{project_id}/envelope/   # trailing slash also accepted

X-Sentry-Auth: Sentry sentry_key={public_key}, sentry_version=7

# or, for SDKs that authenticate via the query string instead:
POST /api/{project_id}/envelope?sentry_key={public_key}

# confirm which environment is live
GET  /api/version   → 200 {"version":"x.y.z","environment":"production"}`,
  },
  {
    id: "sourcemaps",
    title: "Source maps",
    body:
      "Upload artifacts in CI, keyed by release, using the real, unmodified sentry-cli — no separate FlightDeck-specific CLI to install. Generate a sentry-cli API token from the project's Settings screen, then export it and point sentry-cli's own environment variables at FlightDeck.",
    code: `export SENTRY_URL=https://flightdeck.iuma.dev
export SENTRY_AUTH_TOKEN=<token from Settings → sentry-cli API token>
export SENTRY_ORG=acme        # any value — accepted, not validated
export SENTRY_PROJECT=1       # your project id

sentry-cli releases new web@$GIT_SHA
sentry-cli releases files web@$GIT_SHA upload-sourcemaps ./dist
sentry-cli releases finalize web@$GIT_SHA`,
  },
  {
    id: "releases",
    title: "Releases & deploys",
    body:
      "Tell FlightDeck when a version reaches an environment with sentry-cli's own deploys command. Adoption, crash-free rate and regression detection all derive from release and session data ingested this way. Issues also carry regression detection tied to releases: resolving one from the dashboard marks it fixed as of a specific release, and the same underlying error reappearing in a later release reopens it automatically.",
    code: `sentry-cli releases deploys web@$GIT_SHA new -e production`,
  },
  {
    id: "webhooks",
    title: "Uptime webhooks",
    body:
      "An uptime check can notify an external URL when it opens or resolves an incident. Delivery is a single fire-and-forget POST with a 5 second timeout — no retry, and the request is not signed.",
    code: `POST https://hooks.acme.io/flightdeck

{
  "checkId": "chk_1a2b3c",
  "checkName": "API health",
  "event": "incident.opened",
  "incidentId": "inc_9f8e7d"
}`,
  },
  {
    id: "access",
    title: "Access control",
    body:
      "The dashboard sits behind Cloudflare Access — FlightDeck trusts the verified identity from an Access-gated login exchange, verifies the resulting JWT, and maps it to a member record. Ingest endpoints stay public and are authenticated by the DSN key instead.",
    code: `# conceptual — see wrangler.jsonc / .dev.vars.example for the live values
TEAM_DOMAIN = "https://your-team.cloudflareaccess.com"
POLICY_AUD  = "<this application's Access AUD tag>"`,
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
