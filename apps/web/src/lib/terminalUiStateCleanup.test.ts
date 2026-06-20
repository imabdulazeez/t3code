import { terminalOwnerKey, threadTerminalOwnerRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { collectActiveTerminalOwnerKeys } from "./terminalUiStateCleanup";

const threadId = (id: string): ThreadId => ThreadId.make(id);
const ownerKey = (environmentId: string, id: string): string =>
  terminalOwnerKey(threadTerminalOwnerRef(environmentId as never, threadId(id)));

describe("collectActiveTerminalOwnerKeys", () => {
  it("retains non-deleted server threads", () => {
    const activeOwnerKeys = collectActiveTerminalOwnerKeys({
      snapshotThreads: [
        { ownerKey: ownerKey("env-a", "server-1"), deletedAt: null, archivedAt: null },
        { ownerKey: ownerKey("env-b", "server-2"), deletedAt: null, archivedAt: null },
      ],
      draftThreadOwnerKeys: [],
      projectOwnerKeys: [],
    });

    expect(activeOwnerKeys).toEqual(
      new Set([ownerKey("env-a", "server-1"), ownerKey("env-b", "server-2")]),
    );
  });

  it("ignores deleted and archived server threads and keeps local draft threads", () => {
    const activeOwnerKeys = collectActiveTerminalOwnerKeys({
      snapshotThreads: [
        { ownerKey: ownerKey("env-a", "server-active"), deletedAt: null, archivedAt: null },
        {
          ownerKey: ownerKey("env-a", "server-deleted"),
          deletedAt: "2026-03-05T08:00:00.000Z",
          archivedAt: null,
        },
        {
          ownerKey: ownerKey("env-a", "server-archived"),
          deletedAt: null,
          archivedAt: "2026-03-05T09:00:00.000Z",
        },
      ],
      draftThreadOwnerKeys: [ownerKey("env-a", "local-draft")],
      projectOwnerKeys: [],
    });

    expect(activeOwnerKeys).toEqual(
      new Set([ownerKey("env-a", "server-active"), ownerKey("env-a", "local-draft")]),
    );
  });

  it("does not keep draft-linked terminal UI state for archived server threads", () => {
    const archivedOwnerKey = ownerKey("env-a", "server-archived");

    const activeOwnerKeys = collectActiveTerminalOwnerKeys({
      snapshotThreads: [
        {
          ownerKey: archivedOwnerKey,
          deletedAt: null,
          archivedAt: "2026-03-05T09:00:00.000Z",
        },
      ],
      draftThreadOwnerKeys: [archivedOwnerKey, ownerKey("env-a", "local-draft")],
      projectOwnerKeys: [],
    });

    expect(activeOwnerKeys).toEqual(new Set([ownerKey("env-a", "local-draft")]));
  });

  it("retains project owner keys", () => {
    const activeOwnerKeys = collectActiveTerminalOwnerKeys({
      snapshotThreads: [],
      draftThreadOwnerKeys: [],
      projectOwnerKeys: [ownerKey("env-a", "proj-1")],
    });

    expect(activeOwnerKeys).toEqual(new Set([ownerKey("env-a", "proj-1")]));
  });
});
