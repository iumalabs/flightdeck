import { importPKCS8, SignJWT } from "jose";

// research.md §10 (specs/002-error-monitoring): the only durable secret is the App's own private
// key (GITHUB_APP_PRIVATE_KEY, a Worker secret). Everything per-project is either a non-secret
// identifier (installation ID, stored in D1) or a token minted on demand and never persisted.

// GitHub's own recommended skew handling: back-date `iat` by up to 60s to tolerate clock drift
// between this Worker and GitHub's servers, and keep the JWT's lifetime well under GitHub's 10
// minute hard cap.
const CLOCK_SKEW_SECONDS = 60;
const APP_JWT_TTL_SECONDS = 9 * 60;

export async function signAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const key = await importPKCS8(privateKeyPem, "RS256");
  const nowSeconds = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(appId)
    .setIssuedAt(nowSeconds - CLOCK_SKEW_SECONDS)
    .setExpirationTime(nowSeconds + APP_JWT_TTL_SECONDS)
    .sign(key);
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

// GitHub requires a User-Agent on every REST API call, including this one.
export const GITHUB_USER_AGENT = "flightdeck (https://flightdeck.iuma.dev)";

// Raw fetch to GitHub's installation-token-exchange endpoint, exposed (not just the null-swallowing
// exchangeInstallationToken below) so callers that need to tell "GitHub rejected this installation
// ID" apart from "GitHub/the network is unreachable" — issue #98's connect-time validation — can
// inspect the actual response instead of a collapsed null.
export async function requestInstallationTokenResponse(
  appJwt: string,
  installationId: string,
): Promise<Response> {
  return await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": GITHUB_USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
}

export async function exchangeInstallationToken(
  appJwt: string,
  installationId: string,
): Promise<string | null> {
  const response = await requestInstallationTokenResponse(appJwt, installationId);
  if (!response.ok) return null;

  const body = await response.json() as InstallationTokenResponse;
  return body.token ?? null;
}

// Mints a fresh installation access token for one on-demand lookup (research.md §10 step 3) — not
// cached or persisted. Returns null (not a thrown error) on any failure in the exchange, per spec
// FR-011's "suspect commit is null, never an error" requirement.
export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: string,
): Promise<string | null> {
  try {
    const appJwt = await signAppJwt(appId, privateKeyPem);
    return await exchangeInstallationToken(appJwt, installationId);
  } catch {
    return null;
  }
}
