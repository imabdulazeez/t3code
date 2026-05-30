interface TerminalUiRetentionThread {
  ownerKey: string;
  deletedAt: string | null;
  archivedAt: string | null;
}

interface CollectActiveTerminalOwnerKeysInput {
  snapshotThreads: readonly TerminalUiRetentionThread[];
  draftThreadOwnerKeys: Iterable<string>;
  projectOwnerKeys: Iterable<string>;
}

export function collectActiveTerminalOwnerKeys(
  input: CollectActiveTerminalOwnerKeysInput,
): Set<string> {
  const activeOwnerKeys = new Set<string>();
  const snapshotThreadByOwnerKey = new Map(
    input.snapshotThreads.map((thread) => [thread.ownerKey, thread]),
  );
  for (const thread of input.snapshotThreads) {
    if (thread.deletedAt !== null) continue;
    if (thread.archivedAt !== null) continue;
    activeOwnerKeys.add(thread.ownerKey);
  }
  for (const draftOwnerKey of input.draftThreadOwnerKeys) {
    const snapshotThread = snapshotThreadByOwnerKey.get(draftOwnerKey);
    if (
      snapshotThread &&
      (snapshotThread.deletedAt !== null || snapshotThread.archivedAt !== null)
    ) {
      continue;
    }
    activeOwnerKeys.add(draftOwnerKey);
  }
  for (const projectOwnerKey of input.projectOwnerKeys) {
    activeOwnerKeys.add(projectOwnerKey);
  }
  return activeOwnerKeys;
}
