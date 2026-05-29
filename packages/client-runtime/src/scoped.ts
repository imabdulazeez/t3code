import type {
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  TerminalOwner,
  ThreadId,
} from "@t3tools/contracts";

export interface TerminalOwnerRef {
  environmentId: EnvironmentId;
  owner: TerminalOwner;
}

export function threadTerminalOwnerRef(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): TerminalOwnerRef {
  return { environmentId, owner: { type: "thread", threadId } };
}

export function projectTerminalOwnerRef(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): TerminalOwnerRef {
  return { environmentId, owner: { type: "project", projectId } };
}

export function terminalOwnerLocalKey(owner: TerminalOwner): string {
  return owner.type === "thread" ? `thread:${owner.threadId}` : `project:${owner.projectId}`;
}

export function terminalOwnerKey(ref: TerminalOwnerRef): string {
  return `${ref.environmentId}::${terminalOwnerLocalKey(ref.owner)}`;
}

export function parseTerminalOwnerKey(key: string): TerminalOwnerRef | null {
  const separatorIndex = key.indexOf("::");
  if (separatorIndex <= 0 || separatorIndex >= key.length - 2) {
    return null;
  }
  const environmentId = key.slice(0, separatorIndex) as EnvironmentId;
  const localKey = key.slice(separatorIndex + 2);
  if (localKey.startsWith("thread:")) {
    const threadId = localKey.slice("thread:".length);
    return threadId.length > 0
      ? { environmentId, owner: { type: "thread", threadId: threadId as ThreadId } }
      : null;
  }
  if (localKey.startsWith("project:")) {
    const projectId = localKey.slice("project:".length);
    return projectId.length > 0
      ? { environmentId, owner: { type: "project", projectId: projectId as ProjectId } }
      : null;
  }
  return null;
}

export function terminalOwnerRefsEqual(
  left: TerminalOwnerRef | null | undefined,
  right: TerminalOwnerRef | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return terminalOwnerKey(left) === terminalOwnerKey(right);
}

export function scopeProjectRef(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ScopedProjectRef {
  return { environmentId, projectId };
}

export function scopeThreadRef(environmentId: EnvironmentId, threadId: ThreadId): ScopedThreadRef {
  return { environmentId, threadId };
}

export function scopedRefKey(ref: ScopedProjectRef | ScopedThreadRef): string {
  const localId = "projectId" in ref ? ref.projectId : ref.threadId;
  return `${ref.environmentId}:${localId}`;
}

export function scopedProjectKey(ref: ScopedProjectRef): string {
  return scopedRefKey(ref);
}

export function scopedThreadKey(ref: ScopedThreadRef): string {
  return scopedRefKey(ref);
}

function parseScopedKey(key: string): { environmentId: EnvironmentId; localId: string } | null {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }
  return {
    environmentId: key.slice(0, separatorIndex) as EnvironmentId,
    localId: key.slice(separatorIndex + 1),
  };
}

export function parseScopedProjectKey(key: string): ScopedProjectRef | null {
  const parsed = parseScopedKey(key);
  if (!parsed) {
    return null;
  }
  return {
    environmentId: parsed.environmentId,
    projectId: parsed.localId as ProjectId,
  };
}

export function parseScopedThreadKey(key: string): ScopedThreadRef | null {
  const parsed = parseScopedKey(key);
  if (!parsed) {
    return null;
  }
  return {
    environmentId: parsed.environmentId,
    threadId: parsed.localId as ThreadId,
  };
}
