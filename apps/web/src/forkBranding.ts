export const FORK_TAG = "a3";

export function formatForkDisplayVersion(pkgVersion: string, buildTimestamp: string): string {
  return `${pkgVersion}-${FORK_TAG}-${buildTimestamp}`;
}
