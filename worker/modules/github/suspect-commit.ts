import { getInstallationToken, GITHUB_USER_AGENT } from "./app-auth.ts";

export interface SuspectCommit {
  sha: string;
  message: string;
  author: string;
  url: string;
}

interface RepositoryConnectionRow {
  owner: string;
  repo: string;
  installation_id: string;
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author?: { name?: string } };
  author?: { login?: string } | null;
}

interface GithubEnv {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}

// spec FR-011 / research.md §10: the most recent commit touching the culprit frame's file path, in
// the project's connected repository — file-level only, no line-level git-blame. Returns null (not
// an error) whenever a suspect commit simply can't be determined: no repo connected, the token
// exchange fails, the file has no commit history, or GitHub's API errors.
export async function lookupSuspectCommit(
  db: D1Database,
  env: GithubEnv,
  projectId: string,
  filePath: string | null | undefined,
): Promise<SuspectCommit | null> {
  if (!filePath) return null;

  const connection = await db
    .prepare(
      `SELECT owner, repo, installation_id FROM repository_connections WHERE project_id = ?1`,
    )
    .bind(projectId)
    .first<RepositoryConnectionRow>();
  if (!connection) return null;

  const token = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    connection.installation_id,
  );
  if (!token) return null;

  const url = `https://api.github.com/repos/${connection.owner}/${connection.repo}/commits` +
    `?path=${encodeURIComponent(filePath)}&per_page=1`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": GITHUB_USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) return null;

  const commits = await response.json() as GitHubCommit[];
  const commit = commits[0];
  if (!commit) return null;

  return {
    sha: commit.sha,
    message: commit.commit.message,
    author: commit.commit.author?.name ?? commit.author?.login ?? "unknown",
    url: commit.html_url,
  };
}
