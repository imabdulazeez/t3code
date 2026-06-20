// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export function isGitRepository(current: string): boolean {
  do {
    if (NodeFS.existsSync(NodePath.join(current, ".git"))) return true;
  } while (current !== (current = NodePath.dirname(current)));
  return false;
}
