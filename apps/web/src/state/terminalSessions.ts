import { terminalOwnerLocalKey } from "@t3tools/client-runtime/environment";
import {
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  EMPTY_TERMINAL_SESSION_STATE,
  selectRunningSubprocessTerminalIds,
  type KnownTerminalSession,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import type {
  EnvironmentId,
  ProjectId,
  TerminalAttachInput,
  TerminalOwner,
  ThreadId,
} from "@t3tools/contracts";
import { useMemo } from "react";

import { useEnvironmentQuery } from "./query";
import { terminalEnvironment } from "./terminal";

export function useAttachedTerminalSession(input: {
  readonly environmentId: EnvironmentId | null;
  readonly terminal: TerminalAttachInput | null;
}): TerminalSessionState {
  const attach = useEnvironmentQuery(
    input.environmentId !== null && input.terminal !== null
      ? terminalEnvironment.attach({
          environmentId: input.environmentId,
          input: input.terminal,
        })
      : null,
  );
  const metadata = useEnvironmentQuery(
    input.environmentId === null
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );

  return useMemo(() => {
    if (input.environmentId === null || input.terminal === null) {
      return EMPTY_TERMINAL_SESSION_STATE;
    }
    const ownerKey = terminalOwnerLocalKey(input.terminal.owner);
    const summary =
      metadata.data?.find(
        (terminal) =>
          terminalOwnerLocalKey(terminal.owner) === ownerKey &&
          terminal.terminalId === input.terminal?.terminalId,
      ) ?? null;
    const state = combineTerminalSessionState(summary, attach.data ?? EMPTY_TERMINAL_BUFFER_STATE);
    return attach.error === null ? state : { ...state, error: attach.error, status: "error" };
  }, [attach.data, attach.error, input.environmentId, input.terminal, metadata.data]);
}

function useOwnerKnownTerminalSessions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly owner: TerminalOwner | null;
}): ReadonlyArray<KnownTerminalSession> {
  const metadata = useEnvironmentQuery(
    input.environmentId === null
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );
  const ownerKey = input.owner === null ? null : terminalOwnerLocalKey(input.owner);
  return useMemo(() => {
    if (input.environmentId === null) {
      return [];
    }
    return (metadata.data ?? [])
      .filter((summary) => ownerKey === null || terminalOwnerLocalKey(summary.owner) === ownerKey)
      .map((summary) => ({
        target: {
          environmentId: input.environmentId!,
          owner: summary.owner,
          terminalId: summary.terminalId,
        },
        state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
      }))
      .sort((left, right) =>
        left.target.terminalId.localeCompare(right.target.terminalId, undefined, {
          numeric: true,
        }),
      );
  }, [input.environmentId, metadata.data, ownerKey]);
}

export function useKnownTerminalSessions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<KnownTerminalSession> {
  return useOwnerKnownTerminalSessions({
    environmentId: input.environmentId,
    owner: input.threadId === null ? null : { type: "thread", threadId: input.threadId },
  });
}

export function useProjectKnownTerminalSessions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
}): ReadonlyArray<KnownTerminalSession> {
  return useOwnerKnownTerminalSessions({
    environmentId: input.environmentId,
    owner: input.projectId === null ? null : { type: "project", projectId: input.projectId },
  });
}

export function useThreadRunningTerminalIds(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<string> {
  return selectRunningSubprocessTerminalIds(useKnownTerminalSessions(input));
}

export function useProjectRunningTerminalIds(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
}): ReadonlyArray<string> {
  return selectRunningSubprocessTerminalIds(useProjectKnownTerminalSessions(input));
}
