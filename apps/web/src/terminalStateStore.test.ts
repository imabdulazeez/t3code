import {
  projectTerminalOwnerRef,
  scopedThreadKey,
  scopeThreadRef,
  terminalOwnerKey,
  threadTerminalOwnerRef,
} from "@t3tools/client-runtime";
import { type EnvironmentId, ProjectId, ThreadId, type TerminalEvent } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  migratePersistedTerminalStateStoreState,
  selectTerminalEventEntries,
  selectThreadTerminalState,
  useTerminalStateStore,
} from "./terminalStateStore";

const env = (id: string): EnvironmentId => id as unknown as EnvironmentId;
const THREAD_ID = ThreadId.make("thread-1");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_REF = threadTerminalOwnerRef(env("environment-a"), THREAD_ID);
const OTHER_THREAD_REF = threadTerminalOwnerRef(env("environment-b"), THREAD_ID);
const PROJECT_REF = projectTerminalOwnerRef(env("environment-a"), PROJECT_ID);
const THREAD_OWNER = { type: "thread" as const, threadId: THREAD_ID };

function makeTerminalEvent(
  type: TerminalEvent["type"],
  overrides: Partial<TerminalEvent> = {},
): TerminalEvent {
  const base = {
    owner: THREAD_OWNER,
    terminalId: "default",
    createdAt: "2026-04-02T20:00:00.000Z",
  };

  switch (type) {
    case "output":
      return { ...base, type, data: "hello\n", ...overrides } as TerminalEvent;
    case "activity":
      return { ...base, type, hasRunningSubprocess: true, ...overrides } as TerminalEvent;
    case "error":
      return { ...base, type, message: "boom", ...overrides } as TerminalEvent;
    case "cleared":
      return { ...base, type, ...overrides } as TerminalEvent;
    case "exited":
      return { ...base, type, exitCode: 0, exitSignal: null, ...overrides } as TerminalEvent;
    case "started":
    case "restarted":
      return {
        ...base,
        type,
        snapshot: {
          owner: THREAD_OWNER,
          terminalId: "default",
          cwd: "/tmp/workspace",
          worktreePath: null,
          status: "running",
          pid: 123,
          history: "",
          exitCode: null,
          exitSignal: null,
          updatedAt: "2026-04-02T20:00:00.000Z",
        },
        ...overrides,
      } as TerminalEvent;
  }
}

describe("terminalStateStore actions", () => {
  beforeEach(() => {
    useTerminalStateStore.persist.clearStorage();
    useTerminalStateStore.setState({
      terminalStateByThreadKey: {},
      terminalLaunchContextByThreadKey: {},
      terminalEventEntriesByKey: {},
      nextTerminalEventId: 1,
    });
  });

  it("returns a closed default terminal state for unknown owners", () => {
    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadKey,
      THREAD_REF,
    );
    expect(terminalState).toEqual({
      terminalOpen: false,
      terminalHeight: 280,
      terminalIds: ["default"],
      runningTerminalIds: [],
      terminalCommands: {},
      activeTerminalId: "default",
      terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
      activeTerminalGroupId: "group-default",
    });
  });

  it("opens and splits terminals into the active group", () => {
    const store = useTerminalStateStore.getState();
    store.setTerminalOpen(THREAD_REF, true);
    store.splitTerminal(THREAD_REF, "terminal-2");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadKey,
      THREAD_REF,
    );
    expect(terminalState.terminalOpen).toBe(true);
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(terminalState.terminalGroups).toEqual([
      { id: "group-default", terminalIds: ["default", "terminal-2"] },
    ]);
  });

  it("caps splits at four terminals per group", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_REF, "terminal-2");
    store.splitTerminal(THREAD_REF, "terminal-3");
    store.splitTerminal(THREAD_REF, "terminal-4");
    store.splitTerminal(THREAD_REF, "terminal-5");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadKey,
      THREAD_REF,
    );
    expect(terminalState.terminalIds).toEqual([
      "default",
      "terminal-2",
      "terminal-3",
      "terminal-4",
    ]);
    expect(terminalState.terminalGroups).toEqual([
      { id: "group-default", terminalIds: ["default", "terminal-2", "terminal-3", "terminal-4"] },
    ]);
  });

  it("creates new terminals in a separate group", () => {
    useTerminalStateStore.getState().newTerminal(THREAD_REF, "terminal-2");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadKey,
      THREAD_REF,
    );
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(terminalState.activeTerminalGroupId).toBe("group-terminal-2");
    expect(terminalState.terminalGroups).toEqual([
      { id: "group-default", terminalIds: ["default"] },
      { id: "group-terminal-2", terminalIds: ["terminal-2"] },
    ]);
  });

  it("ensures unknown server terminals are registered, opened, and activated", () => {
    const store = useTerminalStateStore.getState();
    store.ensureTerminal(THREAD_REF, "setup-setup", { open: true, active: true });

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadKey,
      THREAD_REF,
    );
    expect(terminalState.terminalOpen).toBe(true);
    expect(terminalState.terminalIds).toEqual(["default", "setup-setup"]);
    expect(terminalState.activeTerminalId).toBe("setup-setup");
    expect(terminalState.terminalGroups).toEqual([
      { id: "group-default", terminalIds: ["default"] },
      { id: "group-setup-setup", terminalIds: ["setup-setup"] },
    ]);
  });

  it("keeps state isolated per environment when raw thread ids collide", () => {
    const store = useTerminalStateStore.getState();
    store.setTerminalOpen(THREAD_REF, true);
    store.newTerminal(OTHER_THREAD_REF, "env-b-terminal");

    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadKey,
        THREAD_REF,
      ).terminalOpen,
    ).toBe(true);
    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadKey,
        OTHER_THREAD_REF,
      ).terminalIds,
    ).toEqual(["default", "env-b-terminal"]);
  });

  it("keeps thread and project owners isolated within the same environment", () => {
    const store = useTerminalStateStore.getState();
    store.setTerminalOpen(THREAD_REF, true);
    store.newTerminal(PROJECT_REF, "project-terminal");

    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadKey,
        THREAD_REF,
      ).terminalIds,
    ).toEqual(["default"]);
    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadKey,
        PROJECT_REF,
      ).terminalIds,
    ).toEqual(["default", "project-terminal"]);
  });

  it("migrates v1 persisted terminal state into owner-keyed state", () => {
    const legacyThreadRef = scopeThreadRef(env("environment-a"), THREAD_ID);
    const legacyProjectKey = scopedThreadKey({
      environmentId: env("environment-a"),
      threadId: "project:project-1" as unknown as ThreadId,
    });
    const migrated = migratePersistedTerminalStateStoreState(
      {
        terminalStateByThreadKey: {
          [scopedThreadKey(legacyThreadRef)]: {
            terminalOpen: true,
            terminalHeight: 320,
            terminalIds: ["default"],
            runningTerminalIds: [],
            activeTerminalId: "default",
            terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
            activeTerminalGroupId: "group-default",
          },
          [legacyProjectKey]: {
            terminalOpen: true,
            terminalHeight: 320,
            terminalIds: ["default"],
            runningTerminalIds: [],
            activeTerminalId: "default",
            terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
            activeTerminalGroupId: "group-default",
          },
          "legacy-thread-id": {
            terminalOpen: true,
            terminalHeight: 320,
            terminalIds: ["default"],
            runningTerminalIds: [],
            activeTerminalId: "default",
            terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
            activeTerminalGroupId: "group-default",
          },
        },
      },
      1,
    );

    const migratedState = {
      terminalOpen: true,
      terminalHeight: 320,
      terminalIds: ["default"],
      runningTerminalIds: [],
      terminalCommands: {},
      activeTerminalId: "default",
      terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
      activeTerminalGroupId: "group-default",
    };
    expect(migrated).toEqual({
      terminalStateByThreadKey: {
        [terminalOwnerKey(THREAD_REF)]: migratedState,
        [terminalOwnerKey(PROJECT_REF)]: migratedState,
      },
      defaultTerminalScopeByProjectId: {},
    });
  });

  it("tracks and clears terminal subprocess activity", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_REF, "terminal-2");
    store.setTerminalActivity(THREAD_REF, "terminal-2", true);
    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadKey,
        THREAD_REF,
      ).runningTerminalIds,
    ).toEqual(["terminal-2"]);

    store.setTerminalActivity(THREAD_REF, "terminal-2", false);
    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadKey,
        THREAD_REF,
      ).runningTerminalIds,
    ).toEqual([]);
  });

  it("keeps an explicit empty state when closing the last terminal", () => {
    const store = useTerminalStateStore.getState();
    store.closeTerminal(THREAD_REF, "default");

    expect(
      useTerminalStateStore.getState().terminalStateByThreadKey[terminalOwnerKey(THREAD_REF)],
    ).toMatchObject({ terminalOpen: false, terminalIds: [], terminalGroups: [] });
    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadKey,
        THREAD_REF,
      ).terminalIds,
    ).toEqual([]);
  });

  it("keeps a valid active terminal after closing an active split terminal", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_REF, "terminal-2");
    store.splitTerminal(THREAD_REF, "terminal-3");
    store.closeTerminal(THREAD_REF, "terminal-3");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadKey,
      THREAD_REF,
    );
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
    expect(terminalState.terminalGroups).toEqual([
      { id: "group-default", terminalIds: ["default", "terminal-2"] },
    ]);
  });

  it("buffers terminal events outside persisted terminal UI state", () => {
    const store = useTerminalStateStore.getState();
    store.recordTerminalEvent(THREAD_REF, makeTerminalEvent("output"));
    store.recordTerminalEvent(THREAD_REF, makeTerminalEvent("activity"));

    const entries = selectTerminalEventEntries(
      useTerminalStateStore.getState().terminalEventEntriesByKey,
      THREAD_REF,
      "default",
    );

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.id)).toEqual([1, 2]);
    expect(entries.map((entry) => entry.event.type)).toEqual(["output", "activity"]);
  });

  it("applies started terminal events to terminal state, launch context, and event buffer", () => {
    const store = useTerminalStateStore.getState();
    store.applyTerminalEvent(
      THREAD_REF,
      makeTerminalEvent("started", {
        terminalId: "setup-bootstrap",
        snapshot: {
          owner: THREAD_OWNER,
          terminalId: "setup-bootstrap",
          cwd: "/tmp/worktree",
          worktreePath: "/tmp/worktree",
          status: "running",
          pid: 123,
          history: "",
          exitCode: null,
          exitSignal: null,
          updatedAt: "2026-04-02T20:00:00.000Z",
        },
      }),
    );

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadKey,
      THREAD_REF,
    );
    const entries = selectTerminalEventEntries(
      useTerminalStateStore.getState().terminalEventEntriesByKey,
      THREAD_REF,
      "setup-bootstrap",
    );

    expect(terminalState.terminalOpen).toBe(true);
    expect(terminalState.activeTerminalId).toBe("setup-bootstrap");
    expect(terminalState.terminalIds).toEqual(["default", "setup-bootstrap"]);
    expect(
      useTerminalStateStore.getState().terminalLaunchContextByThreadKey[
        terminalOwnerKey(THREAD_REF)
      ],
    ).toEqual({
      cwd: "/tmp/worktree",
      worktreePath: "/tmp/worktree",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.event.type).toBe("started");
  });

  it("applies project-owned terminal events to the project owner state", () => {
    const store = useTerminalStateStore.getState();
    store.applyTerminalEvent(
      PROJECT_REF,
      makeTerminalEvent("started", {
        owner: { type: "project", projectId: PROJECT_ID },
        terminalId: "project-default",
        snapshot: {
          owner: { type: "project", projectId: PROJECT_ID },
          terminalId: "project-default",
          cwd: "/tmp/project",
          worktreePath: null,
          status: "running",
          pid: 321,
          history: "",
          exitCode: null,
          exitSignal: null,
          updatedAt: "2026-04-02T20:00:00.000Z",
        },
      }),
    );

    const projectState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadKey,
      PROJECT_REF,
    );
    expect(projectState.terminalOpen).toBe(true);
    expect(projectState.terminalIds).toEqual(["default", "project-default"]);
    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadKey,
        THREAD_REF,
      ).terminalIds,
    ).toEqual(["default"]);
  });

  it("applies activity and exited terminal events to subprocess state while buffering events", () => {
    const store = useTerminalStateStore.getState();
    store.ensureTerminal(THREAD_REF, "terminal-2", { open: true, active: true });

    store.applyTerminalEvent(
      THREAD_REF,
      makeTerminalEvent("activity", {
        terminalId: "terminal-2",
        hasRunningSubprocess: true,
      }),
    );
    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadKey,
        THREAD_REF,
      ).runningTerminalIds,
    ).toEqual(["terminal-2"]);

    store.applyTerminalEvent(
      THREAD_REF,
      makeTerminalEvent("exited", {
        terminalId: "terminal-2",
        exitCode: 0,
        exitSignal: null,
      }),
    );

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadKey,
      THREAD_REF,
    );
    const entries = selectTerminalEventEntries(
      useTerminalStateStore.getState().terminalEventEntriesByKey,
      THREAD_REF,
      "terminal-2",
    );

    expect(terminalState.runningTerminalIds).toEqual([]);
    expect(entries.map((entry) => entry.event.type)).toEqual(["activity", "exited"]);
  });

  it("clears buffered terminal events when an owner terminal state is removed", () => {
    const store = useTerminalStateStore.getState();
    store.recordTerminalEvent(THREAD_REF, makeTerminalEvent("output"));
    store.removeTerminalState(THREAD_REF);

    const entries = selectTerminalEventEntries(
      useTerminalStateStore.getState().terminalEventEntriesByKey,
      THREAD_REF,
      "default",
    );

    expect(entries).toEqual([]);
  });

  it("is a no-op when clearing terminal state for an owner with no state or buffered events", () => {
    const store = useTerminalStateStore.getState();
    const before = useTerminalStateStore.getState();

    store.clearTerminalState(THREAD_REF);

    expect(useTerminalStateStore.getState()).toBe(before);
  });
});
