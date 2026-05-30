import { useAtomValue } from "@effect/atom-react";
import {
  createTerminalSessionManager,
  EMPTY_KNOWN_TERMINAL_SESSIONS_ATOM,
  EMPTY_TERMINAL_SESSION_ATOM,
  getKnownTerminalSessionTarget,
  getKnownTerminalSessionListFilter,
  knownTerminalSessionsAtom,
  terminalSessionStateAtom,
  type TerminalSessionState,
} from "@t3tools/client-runtime";
import type {
  EnvironmentId,
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalMetadataStreamEvent,
  TerminalOwner,
  TerminalSessionSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import { useMemo } from "react";

export interface MobileTerminalTarget {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly terminalId: string | null;
}

function threadOwner(threadId: ThreadId | null): TerminalOwner | null {
  return threadId === null ? null : { type: "thread", threadId };
}

import { appAtomRegistry } from "./atom-registry";

export const terminalSessionManager = createTerminalSessionManager({
  getRegistry: () => appAtomRegistry,
});

export function subscribeTerminalMetadata(input: {
  readonly environmentId: EnvironmentId;
  readonly client: {
    readonly terminal: {
      readonly onMetadata: (
        listener: (event: TerminalMetadataStreamEvent) => void,
        options?: { readonly onResubscribe?: () => void },
      ) => () => void;
    };
  };
}) {
  return terminalSessionManager.subscribeMetadata(input);
}

export function attachTerminalSession(input: {
  readonly environmentId: EnvironmentId;
  readonly client: Parameters<typeof terminalSessionManager.attach>[0]["client"];
  readonly terminal: TerminalAttachInput;
  readonly onSnapshot?: (snapshot: TerminalSessionSnapshot) => void;
  readonly onEvent?: (event: TerminalAttachStreamEvent) => void;
}) {
  return terminalSessionManager.attach({
    environmentId: input.environmentId,
    client: input.client,
    terminal: input.terminal,
    ...(input.onSnapshot ? { onSnapshot: input.onSnapshot } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  });
}

export function useTerminalSession(input: MobileTerminalTarget): TerminalSessionState {
  const target = getKnownTerminalSessionTarget({
    environmentId: input.environmentId,
    owner: threadOwner(input.threadId),
    terminalId: input.terminalId,
  });
  return useAtomValue(
    target !== null ? terminalSessionStateAtom(target) : EMPTY_TERMINAL_SESSION_ATOM,
  );
}

export function useTerminalSessionTarget(input: MobileTerminalTarget) {
  return useMemo(
    () => ({
      environmentId: input.environmentId,
      threadId: input.threadId,
      terminalId: input.terminalId,
    }),
    [input.environmentId, input.threadId, input.terminalId],
  );
}

export function useKnownTerminalSessions(input: {
  readonly environmentId: MobileTerminalTarget["environmentId"];
  readonly threadId: MobileTerminalTarget["threadId"];
}) {
  const filter = getKnownTerminalSessionListFilter({
    environmentId: input.environmentId,
    owner: threadOwner(input.threadId),
  });
  return useAtomValue(
    filter !== null ? knownTerminalSessionsAtom(filter) : EMPTY_KNOWN_TERMINAL_SESSIONS_ATOM,
  );
}
