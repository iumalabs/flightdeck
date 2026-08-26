// Non-blocking CI nudge (issue #104, and #80/#86/#96 before it): the public `/changelog` page
// (app/pages/ChangelogPage.tsx) is a deliberately hand-curated, honest-entries-only list — see
// that file's own header comment — not something this script auto-generates. It exists purely so
// nobody has to notice the drift by eye again; it never fails the build, only prints a loud,
// impossible-to-miss warning annotation in the CI logs/PR checks UI when the root VERSION file has
// moved past the changelog's newest entry.
//
// Deliberately non-blocking: whether a given release's changes are even worth a changelog entry
// is an editorial call (see ChangelogPage.tsx's own precedent of omitting changelog-only or
// marketing-copy-only releases), not something this script can decide — it only detects "VERSION
// moved, the page didn't," which is a reliable enough signal to be worth surfacing every time
// regardless.

const VERSION_FILE = "VERSION";
const CHANGELOG_FILE = "app/pages/ChangelogPage.tsx";

function parseSemver(v: string): [number, number, number] {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Not a semver-shaped version: "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

const currentVersion = (await Deno.readTextFile(VERSION_FILE)).trim();
const changelogSource = await Deno.readTextFile(CHANGELOG_FILE);

// The CHANGELOG array is written newest-first (existing convention) — the first `version: "..."`
// literal in the file is the newest entry.
const match = changelogSource.match(/version:\s*"([^"]+)"/);
if (!match) {
  console.log(
    `::warning file=${CHANGELOG_FILE}::Could not find a "version: \"X.Y.Z\"" entry in ${CHANGELOG_FILE} to check against VERSION (${currentVersion}). If the file's structure changed, update this script (scripts/check-changelog-current.ts) to match.`,
  );
  Deno.exit(0);
}

const changelogVersion = match[1];

try {
  if (isNewer(parseSemver(currentVersion), parseSemver(changelogVersion))) {
    console.log(
      `::warning file=${CHANGELOG_FILE}::Public changelog is behind: VERSION is ${currentVersion}, but ${CHANGELOG_FILE}'s newest entry is still ${changelogVersion}. If anything shipped since ${changelogVersion} is worth telling users about, add an entry (see ${CHANGELOG_FILE}'s own header comment for what counts) and open a PR referencing this. Not required for this PR — it's an editorial call, and this check never blocks merges — just easy to forget otherwise (see issues #80, #86, #96, #104).`,
    );
  } else {
    console.log(`Changelog is current (VERSION ${currentVersion}, changelog ${changelogVersion}).`);
  }
} catch (e) {
  console.log(
    `::warning file=${CHANGELOG_FILE}::Could not compare versions (VERSION="${currentVersion}", changelog="${changelogVersion}"): ${
      e instanceof Error ? e.message : String(e)
    }`,
  );
}

// Always succeeds — see the module comment. This is a signal, not a gate.
Deno.exit(0);
