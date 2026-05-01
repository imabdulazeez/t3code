import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

export function isGitRepository(cwd: string): boolean {
  const root = parse(cwd).root;
  let current = cwd;
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return true;
    }
    if (current === root) {
      return false;
    }
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}
