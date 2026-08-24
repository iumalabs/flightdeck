// Pure sentry-cli request-shape helpers (research.md §1, §3, specs/005-releases) — kept separate
// from routes.ts so the parsing/authorization logic is unit-testable without a D1 binding.

// A token is project-scoped (research.md §4) — `sentry-cli releases new`'s `projects: [slugs]`
// array is how the request actually resolves which project(s) a release belongs to, regardless of
// the URL's `{org_slug}`, which is accepted but never validated (research.md §3).
export function isProjectAuthorized(tokenProjectId: string, requestedProjects: string[]): boolean {
  return requestedProjects.includes(tokenProjectId);
}

// The project-scoped path variants (`/api/0/projects/{org_slug}/{project_slug}/releases/...`,
// T045) carry the project directly in the URL rather than a request body array — a token may only
// operate on the one project it's scoped to (research.md §4), same rule as isProjectAuthorized
// above, just against a single path segment instead of a list.
export function isProjectSlugAuthorized(tokenProjectId: string, projectSlug: string): boolean {
  return projectSlug === tokenProjectId;
}

export interface CommitInput {
  id?: string;
  message?: string;
  author_name?: string;
}

export interface CommitRow {
  sha: string;
  message: string | null;
  author: string | null;
}

// `sentry-cli releases set-commits` sends commit data directly in the same PUT request body used
// for finalize (research.md §1's correction) — this maps that wire shape to release_commits rows.
export function commitsToRows(commits: CommitInput[]): CommitRow[] {
  return commits
    .filter((commit) => typeof commit.id === "string" && commit.id.length > 0)
    .map((commit) => ({
      sha: commit.id!,
      message: commit.message ?? null,
      author: commit.author_name ?? null,
    }));
}
