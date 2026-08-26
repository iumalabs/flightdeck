import { GITHUB_USER_AGENT, requestInstallationTokenResponse, signAppJwt } from "./app-auth.ts";

// issue #98: POST /:id/github/connect used to persist any installationId/owner/repo the user typed
// in, with nothing beyond a `typeof === "string"` check. This module makes the connect route
// actually confirm, against GitHub's real API, that (a) the installation ID is real and (b) that
// specific installation's token has access to the given owner/repo — before anything is written to
// `repository_connections`.

export type ConnectionCheckResult =
  | { ok: true }
  | { ok: false; status: 400; message: string }
  | { ok: false; status: 502; message: string };

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

// Distinguishes "you gave us bad input" (400 — GitHub cleanly rejected the installation ID, or the
// installation's token has no access to that owner/repo) from "we tried to reach GitHub and it
// failed" (502 — signing failed, the network is down, or GitHub itself errored) — the same
// distinction worker/modules/logs/routes.ts draws for its own GitHub/Cloudflare-API-backed
// provisioning failure (`c.text("Failed to provision export access", 502)`).
export async function verifyInstallationCoversRepo(
  appId: string,
  privateKeyPem: string,
  installationId: string,
  owner: string,
  repo: string,
): Promise<ConnectionCheckResult> {
  let appJwt: string;
  try {
    appJwt = await signAppJwt(appId, privateKeyPem);
  } catch {
    return { ok: false, status: 502, message: "Could not sign GitHub App credentials." };
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await requestInstallationTokenResponse(appJwt, installationId);
  } catch {
    return {
      ok: false,
      status: 502,
      message: "Could not reach GitHub to verify the installation.",
    };
  }

  if (tokenResponse.status === 401 || tokenResponse.status === 404) {
    return {
      ok: false,
      status: 400,
      message: "GitHub rejected this installation ID. Double-check it and try again.",
    };
  }
  if (!tokenResponse.ok) {
    return {
      ok: false,
      status: 502,
      message:
        `GitHub returned an unexpected error verifying the installation (${tokenResponse.status}).`,
    };
  }

  const tokenBody = await tokenResponse.json() as InstallationTokenResponse;
  const installationToken = tokenBody.token;
  if (!installationToken) {
    return { ok: false, status: 502, message: "GitHub did not return an installation token." };
  }

  let repoResponse: Response;
  try {
    repoResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: {
          Authorization: `Bearer ${installationToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": GITHUB_USER_AGENT,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  } catch {
    return {
      ok: false,
      status: 502,
      message: "Could not reach GitHub to verify repository access.",
    };
  }

  if (repoResponse.status === 401 || repoResponse.status === 404) {
    return {
      ok: false,
      status: 400,
      message: "This installation does not have access to that owner/repo.",
    };
  }
  if (!repoResponse.ok) {
    return {
      ok: false,
      status: 502,
      message:
        `GitHub returned an unexpected error verifying repository access (${repoResponse.status}).`,
    };
  }

  return { ok: true };
}
