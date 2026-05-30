import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type EnvironmentId as EnvironmentIdType,
  type ProjectId as ProjectIdType,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type TerminalOwner,
} from "@t3tools/contracts";

export interface TerminalOwnerRef {
  environmentId: EnvironmentIdType;
  owner: TerminalOwner;
}

export function threadTerminalOwnerRef(
  environmentId: EnvironmentIdType,
  threadId: ThreadId,
): TerminalOwnerRef {
  return { environmentId, owner: { type: "thread", threadId } };
}

export function projectTerminalOwnerRef(
  environmentId: EnvironmentIdType,
  projectId: ProjectIdType,
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
  const environmentId = EnvironmentId.make(key.slice(0, separatorIndex));
  const localKey = key.slice(separatorIndex + 2);
  if (localKey.startsWith("thread:")) {
    const threadId = localKey.slice("thread:".length);
    return threadId.length > 0
      ? { environmentId, owner: { type: "thread", threadId: ThreadId.make(threadId) } }
      : null;
  }
  if (localKey.startsWith("project:")) {
    const projectId = localKey.slice("project:".length);
    return projectId.length > 0
      ? { environmentId, owner: { type: "project", projectId: ProjectId.make(projectId) } }
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
  environmentId: EnvironmentIdType,
  projectId: ProjectIdType,
): ScopedProjectRef {
  return { environmentId, projectId };
}

export function scopeThreadRef(
  environmentId: EnvironmentIdType,
  threadId: ThreadId,
): ScopedThreadRef {
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

function parseScopedKey(key: string): { environmentId: EnvironmentIdType; localId: string } | null {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }
  return {
    environmentId: EnvironmentId.make(key.slice(0, separatorIndex)),
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
    projectId: ProjectId.make(parsed.localId),
  };
}

export function parseScopedThreadKey(key: string): ScopedThreadRef | null {
  const parsed = parseScopedKey(key);
  if (!parsed) {
    return null;
  }
  return {
    environmentId: parsed.environmentId,
    threadId: ThreadId.make(parsed.localId),
  };
}
