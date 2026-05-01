import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function isGitRepository(current: string): boolean {
  while (current !== (current = dirname(current))) {
    if (existsSync(join(current, ".git"))) return true;
  }
  return false;
}
