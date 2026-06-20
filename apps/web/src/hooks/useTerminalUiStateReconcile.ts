import { useAtomValue } from "@effect/atom-react";
import {
  projectTerminalOwnerRef,
  terminalOwnerKey,
  threadTerminalOwnerRef,
} from "@t3tools/client-runtime/environment";
import { useEffect, useMemo } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { collectActiveTerminalOwnerKeys } from "../lib/terminalUiStateCleanup";
import { useProjects, useThreadShells } from "../state/entities";
import { environmentShellSummaryAtom } from "../state/shell";
import { useTerminalUiStateStore } from "../terminalUiStateStore";

export function useTerminalUiStateReconcile(): void {
  const threadShells = useThreadShells();
  const projects = useProjects();
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const hasSnapshot = useAtomValue(environmentShellSummaryAtom).hasSnapshot;

  const activeOwnerKeys = useMemo(
    () =>
      collectActiveTerminalOwnerKeys({
        snapshotThreads: threadShells.map((thread) => ({
          ownerKey: terminalOwnerKey(threadTerminalOwnerRef(thread.environmentId, thread.id)),
          deletedAt: null,
          archivedAt: thread.archivedAt,
        })),
        draftThreadOwnerKeys: Object.values(draftThreadsByThreadKey).map((draftThread) =>
          terminalOwnerKey(threadTerminalOwnerRef(draftThread.environmentId, draftThread.threadId)),
        ),
        projectOwnerKeys: projects.map((project) =>
          terminalOwnerKey(projectTerminalOwnerRef(project.environmentId, project.id)),
        ),
      }),
    [threadShells, projects, draftThreadsByThreadKey],
  );

  useEffect(() => {
    if (!hasSnapshot) {
      return;
    }
    useTerminalUiStateStore.getState().removeOrphanedTerminalUiStates(activeOwnerKeys);
  }, [activeOwnerKeys, hasSnapshot]);
}
