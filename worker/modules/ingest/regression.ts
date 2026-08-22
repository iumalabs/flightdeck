// Regression detection — research.md §7 (specs/005-releases). A pure, replicable comparison:
// "was this new occurrence's release created LATER than the release the resolution referenced?"
// Ordering is by creation order (releases.created_at, insertion order), not by a raw client-
// reported timestamp — a release finalized out of upload order still compares correctly.

export interface ReleaseOrdering {
  id: string;
  createdAt: string;
}

// `resolvedMode: "exact"` compares the new event's release directly against the resolved release's
// own position. `"next-release"` compares against whichever release was created immediately AFTER
// the resolution — passed in as `nextReleaseAfterResolution` (null if none exists yet, in which
// case no regression is possible, per spec.md's Edge Cases: "no 'next release' for it to have
// regressed against yet").
export function isRegression(
  resolvedMode: "exact" | "next-release",
  resolvedRelease: ReleaseOrdering,
  nextReleaseAfterResolution: ReleaseOrdering | null,
  newEventRelease: ReleaseOrdering,
): boolean {
  const comparisonBasis = resolvedMode === "exact" ? resolvedRelease : nextReleaseAfterResolution;
  if (!comparisonBasis) return false;

  if (newEventRelease.id === resolvedRelease.id) return false; // same release — never a regression

  if (resolvedMode === "exact") {
    return newEventRelease.createdAt > comparisonBasis.createdAt;
  }

  // "next-release" mode: regress only for a release at-or-after the one that existed right after
  // resolution — an event on that exact next release already counts (it's the first release the
  // fix was expected to hold through), but the RESOLVED release itself, or anything earlier,
  // never does.
  return newEventRelease.createdAt >= comparisonBasis.createdAt;
}
