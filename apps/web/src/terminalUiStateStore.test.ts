import {
  scopedThreadKey,
  scopeThreadRef,
  terminalOwnerKey,
  threadTerminalOwnerRef,
} from "@t3tools/client-runtime";
import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  migratePersistedTerminalUiStateStoreState,
  selectThreadTerminalUiState,
  useTerminalUiStateStore,
} from "./terminalUiStateStore";
import { DEFAULT_THREAD_TERMINAL_ID } from "./types";

const THREAD_ID = ThreadId.make("thread-1");
const THREAD_REF = scopeThreadRef("environment-a" as never, THREAD_ID);
const OWNER_REF = threadTerminalOwnerRef("environment-a" as never, THREAD_ID);
const OTHER_OWNER_REF = threadTerminalOwnerRef("environment-b" as never, THREAD_ID);

describe("terminalUiStateStore actions", () => {
  beforeEach(() => {
    useTerminalUiStateStore.persist.clearStorage();
    useTerminalUiStateStore.setState({
      terminalUiStateByOwnerKey: {},
    });
  });

  it("returns an empty default terminal UI state for unknown threads", () => {
    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
      OWNER_REF,
    );
    expect(terminalUiState).toEqual({
      terminalOpen: false,
      terminalHeight: 280,
      terminalIds: [],
      activeTerminalId: "",
      terminalGroups: [],
      activeTerminalGroupId: "",
    });
  });

  it("opens and splits terminals into the active group", () => {
    const store = useTerminalUiStateStore.getState();
    store.setTerminalOpen(OWNER_REF, true);
    store.splitTerminal(OWNER_REF, "terminal-2");

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
      OWNER_REF,
    );
    expect(terminalUiState.terminalOpen).toBe(true);
    expect(terminalUiState.terminalIds).toEqual([DEFAULT_THREAD_TERMINAL_ID, "terminal-2"]);
    expect(terminalUiState.activeTerminalId).toBe("terminal-2");
    expect(terminalUiState.terminalGroups).toEqual([
      {
        id: `group-${DEFAULT_THREAD_TERMINAL_ID}`,
        terminalIds: [DEFAULT_THREAD_TERMINAL_ID, "terminal-2"],
      },
    ]);
  });

  it("materializes the default terminal when opening an empty drawer", () => {
    useTerminalUiStateStore.getState().setTerminalOpen(OWNER_REF, true);

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
      OWNER_REF,
    );
    expect(terminalUiState).toEqual({
      terminalOpen: true,
      terminalHeight: 280,
      terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
      activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
      terminalGroups: [
        {
          id: `group-${DEFAULT_THREAD_TERMINAL_ID}`,
          terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
        },
      ],
      activeTerminalGroupId: `group-${DEFAULT_THREAD_TERMINAL_ID}`,
    });
  });

  it("caps splits at four terminals per group", () => {
    const store = useTerminalUiStateStore.getState();
    store.splitTerminal(OWNER_REF, "terminal-2");
    store.splitTerminal(OWNER_REF, "terminal-3");
    store.splitTerminal(OWNER_REF, "terminal-4");
    store.splitTerminal(OWNER_REF, "terminal-5");
    store.splitTerminal(OWNER_REF, "terminal-6");

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
      OWNER_REF,
    );
    expect(terminalUiState.terminalIds).toEqual([
      "terminal-2",
      "terminal-3",
      "terminal-4",
      "terminal-5",
    ]);
    expect(terminalUiState.terminalGroups).toEqual([
      {
        id: "group-terminal-2",
        terminalIds: ["terminal-2", "terminal-3", "terminal-4", "terminal-5"],
      },
    ]);
  });

  it("creates new terminals in a separate group", () => {
    useTerminalUiStateStore.getState().newTerminal(OWNER_REF, "terminal-2");

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
      OWNER_REF,
    );
    expect(terminalUiState.terminalIds).toEqual(["terminal-2"]);
    expect(terminalUiState.activeTerminalId).toBe("terminal-2");
    expect(terminalUiState.activeTerminalGroupId).toBe("group-terminal-2");
    expect(terminalUiState.terminalGroups).toEqual([
      { id: "group-terminal-2", terminalIds: ["terminal-2"] },
    ]);
  });

  it("ensures unknown server terminals are registered, opened, and activated", () => {
    const store = useTerminalUiStateStore.getState();
    store.ensureTerminal(OWNER_REF, "setup-setup", { open: true, active: true });

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
      OWNER_REF,
    );
    expect(terminalUiState.terminalOpen).toBe(true);
    expect(terminalUiState.terminalIds).toEqual(["setup-setup"]);
    expect(terminalUiState.activeTerminalId).toBe("setup-setup");
    expect(terminalUiState.terminalGroups).toEqual([
      { id: "group-setup-setup", terminalIds: ["setup-setup"] },
    ]);
  });

  it("keeps state isolated per environment when raw thread ids collide", () => {
    const store = useTerminalUiStateStore.getState();
    store.setTerminalOpen(OWNER_REF, true);
    store.newTerminal(OTHER_OWNER_REF, "env-b-terminal");

    expect(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
        OWNER_REF,
      ).terminalOpen,
    ).toBe(true);
    expect(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
        OTHER_OWNER_REF,
      ).terminalIds,
    ).toEqual(["env-b-terminal"]);
  });

  it("migrates legacy scoped thread keys to owner keys and drops invalid keys", () => {
    const migrated = migratePersistedTerminalUiStateStoreState(
      {
        terminalStateByThreadKey: {
          [scopedThreadKey(THREAD_REF)]: {
            terminalOpen: true,
            terminalHeight: 320,
            terminalIds: ["term-1"],
            activeTerminalId: "term-1",
            terminalGroups: [{ id: "group-term-1", terminalIds: ["term-1"] }],
            activeTerminalGroupId: "group-term-1",
          },
          "legacy-thread-id": {
            terminalOpen: true,
            terminalHeight: 320,
            terminalIds: ["term-1"],
            activeTerminalId: "term-1",
            terminalGroups: [{ id: "group-term-1", terminalIds: ["term-1"] }],
            activeTerminalGroupId: "group-term-1",
          },
        },
      },
      2,
    );

    expect(migrated).toEqual({
      terminalUiStateByOwnerKey: {
        [terminalOwnerKey(OWNER_REF)]: {
          terminalOpen: true,
          terminalHeight: 320,
          terminalIds: ["term-1"],
          activeTerminalId: "term-1",
          terminalGroups: [{ id: "group-term-1", terminalIds: ["term-1"] }],
          activeTerminalGroupId: "group-term-1",
        },
      },
      defaultTerminalScopeByProjectId: {},
    });
  });

  it("resets to default and clears persisted entry when closing the last terminal", () => {
    const store = useTerminalUiStateStore.getState();
    store.newTerminal(OWNER_REF, "terminal-only");
    store.closeTerminal(OWNER_REF, "terminal-only");

    expect(
      useTerminalUiStateStore.getState().terminalUiStateByOwnerKey[terminalOwnerKey(OWNER_REF)],
    ).toBeUndefined();
    expect(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
        OWNER_REF,
      ).terminalIds,
    ).toEqual([]);
  });

  it("keeps a valid active terminal after closing an active split terminal", () => {
    const store = useTerminalUiStateStore.getState();
    store.splitTerminal(OWNER_REF, "terminal-2");
    store.splitTerminal(OWNER_REF, "terminal-3");
    store.closeTerminal(OWNER_REF, "terminal-3");

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
      OWNER_REF,
    );
    expect(terminalUiState.activeTerminalId).toBe("terminal-2");
    expect(terminalUiState.terminalIds).toEqual(["terminal-2"]);
    expect(terminalUiState.terminalGroups).toEqual([
      { id: "group-terminal-2", terminalIds: ["terminal-2"] },
    ]);
  });

  it("reconciles terminal ids from an external ordered list", () => {
    const store = useTerminalUiStateStore.getState();
    store.setTerminalOpen(OWNER_REF, true);
    store.reconcileTerminalIds(OWNER_REF, ["term-a", "term-b"]);

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByOwnerKey,
      OWNER_REF,
    );
    expect(terminalUiState.terminalIds).toEqual(["term-a", "term-b"]);
    expect(terminalUiState.activeTerminalId).toBe("term-a");
    expect(terminalUiState.terminalGroups).toEqual([
      { id: "group-term-a", terminalIds: ["term-a"] },
      { id: "group-term-b", terminalIds: ["term-b"] },
    ]);
  });

  it("is a no-op when clearing terminal UI state for a thread with no state", () => {
    const store = useTerminalUiStateStore.getState();
    const before = useTerminalUiStateStore.getState();

    store.clearTerminalUiState(OWNER_REF);

    expect(useTerminalUiStateStore.getState()).toBe(before);
  });
});
