import {
  projectTerminalOwnerRef,
  terminalOwnerKey,
  threadTerminalOwnerRef,
} from "@t3tools/client-runtime";
import { type EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { collectActiveTerminalOwnerKeys } from "./terminalStateCleanup";

const env = (id: string): EnvironmentId => id as unknown as EnvironmentId;
const threadKey = (environmentId: string, id: string): string =>
  terminalOwnerKey(threadTerminalOwnerRef(env(environmentId), ThreadId.make(id)));
const projectKey = (environmentId: string, id: string): string =>
  terminalOwnerKey(projectTerminalOwnerRef(env(environmentId), ProjectId.make(id)));

describe("collectActiveTerminalOwnerKeys", () => {
  it("retains non-deleted server thread owners and active project owners", () => {
    const activeOwnerKeys = collectActiveTerminalOwnerKeys({
      snapshotThreads: [
        { ownerKey: threadKey("env-a", "server-1"), deletedAt: null, archivedAt: null },
        { ownerKey: threadKey("env-b", "server-2"), deletedAt: null, archivedAt: null },
      ],
      draftThreadOwnerKeys: [],
      projectOwnerKeys: [projectKey("env-a", "project-1")],
    });

    expect(activeOwnerKeys).toEqual(
      new Set([
        threadKey("env-a", "server-1"),
        threadKey("env-b", "server-2"),
        projectKey("env-a", "project-1"),
      ]),
    );
  });

  it("ignores deleted and archived server threads and keeps local draft threads", () => {
    const activeOwnerKeys = collectActiveTerminalOwnerKeys({
      snapshotThreads: [
        { ownerKey: threadKey("env-a", "server-active"), deletedAt: null, archivedAt: null },
        {
          ownerKey: threadKey("env-a", "server-deleted"),
          deletedAt: "2026-03-05T08:00:00.000Z",
          archivedAt: null,
        },
        {
          ownerKey: threadKey("env-a", "server-archived"),
          deletedAt: null,
          archivedAt: "2026-03-05T09:00:00.000Z",
        },
      ],
      draftThreadOwnerKeys: [threadKey("env-a", "local-draft")],
      projectOwnerKeys: [],
    });

    expect(activeOwnerKeys).toEqual(
      new Set([threadKey("env-a", "server-active"), threadKey("env-a", "local-draft")]),
    );
  });

  it("does not keep draft-linked terminal state for archived server threads", () => {
    const archivedOwnerKey = threadKey("env-a", "server-archived");

    const activeOwnerKeys = collectActiveTerminalOwnerKeys({
      snapshotThreads: [
        {
          ownerKey: archivedOwnerKey,
          deletedAt: null,
          archivedAt: "2026-03-05T09:00:00.000Z",
        },
      ],
      draftThreadOwnerKeys: [archivedOwnerKey, threadKey("env-a", "local-draft")],
      projectOwnerKeys: [],
    });

    expect(activeOwnerKeys).toEqual(new Set([threadKey("env-a", "local-draft")]));
  });

  it("retains project owners regardless of thread lifecycle", () => {
    const activeOwnerKeys = collectActiveTerminalOwnerKeys({
      snapshotThreads: [
        {
          ownerKey: threadKey("env-a", "server-archived"),
          deletedAt: null,
          archivedAt: "2026-03-05T09:00:00.000Z",
        },
      ],
      draftThreadOwnerKeys: [],
      projectOwnerKeys: [projectKey("env-a", "project-1")],
    });

    expect(activeOwnerKeys).toEqual(new Set([projectKey("env-a", "project-1")]));
  });
});
