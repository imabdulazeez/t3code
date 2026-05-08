import type { DesktopAppStageLabel } from "@t3tools/contracts";

export const FORK_TAG = "a3";
export const FORK_STAGE_LABEL: DesktopAppStageLabel = "A3";

export function formatForkDisplayVersion(pkgVersion: string, buildTimestamp: string): string {
  return `${pkgVersion}-${FORK_TAG}-${buildTimestamp}`;
}
