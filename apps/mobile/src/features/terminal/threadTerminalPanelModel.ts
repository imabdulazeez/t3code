import type { EnvironmentId, TerminalAttachInput, ThreadId } from "@t3tools/contracts";

export interface ThreadTerminalSubscriptionIdentity {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: TerminalAttachInput["terminalId"];
  readonly cwd: string;
  readonly worktreePath: string | null;
}

export interface TerminalGridSize {
  readonly cols: number;
  readonly rows: number;
}

export function threadTerminalSubscriptionKey(
  identity: ThreadTerminalSubscriptionIdentity,
): string {
  return JSON.stringify([
    identity.environmentId,
    identity.threadId,
    identity.terminalId,
    identity.cwd,
    identity.worktreePath,
  ]);
}

export function buildThreadTerminalAttachInput(
  identity: ThreadTerminalSubscriptionIdentity,
  gridSize: TerminalGridSize,
): TerminalAttachInput {
  return {
    owner: { type: "thread", threadId: identity.threadId },
    terminalId: identity.terminalId,
    cwd: identity.cwd,
    worktreePath: identity.worktreePath,
    cols: gridSize.cols,
    rows: gridSize.rows,
  };
}
