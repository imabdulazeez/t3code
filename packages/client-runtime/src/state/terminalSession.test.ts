import { describe, expect, it } from "vite-plus/test";

import {
  EnvironmentId,
  ProjectId,
  type TerminalOwner,
  TerminalSessionSnapshot,
  ThreadId,
} from "@t3tools/contracts";

import {
  applyTerminalAttachStreamEvent,
  applyTerminalMetadataStreamEvent,
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  selectRunningSubprocessTerminalIds,
} from "./terminalSession.ts";

const OWNER: TerminalOwner = { type: "thread", threadId: ThreadId.make("thread-1") };
const PROJECT_OWNER: TerminalOwner = { type: "project", projectId: ProjectId.make("project-1") };

const TARGET = {
  environmentId: EnvironmentId.make("env-local"),
  owner: OWNER,
  terminalId: "term-1",
} as const;

const BASE_SNAPSHOT: TerminalSessionSnapshot = {
  owner: OWNER,
  terminalId: TARGET.terminalId,
  cwd: "/repo",
  worktreePath: null,
  status: "running",
  pid: 123,
  history: "hello",
  exitCode: null,
  exitSignal: null,
  label: "Terminal 1",
  updatedAt: "2026-04-01T00:00:00.000Z",
};

describe("terminal session reducers", () => {
  it("prefers live attach status over stale metadata after the attach stream starts", () => {
    const summary = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          owner: BASE_SNAPSHOT.owner,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: "running",
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: BASE_SNAPSHOT.updatedAt,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    })[0]!;
    const attached = applyTerminalAttachStreamEvent(EMPTY_TERMINAL_BUFFER_STATE, {
      type: "error",
      owner: TARGET.owner,
      terminalId: TARGET.terminalId,
      message: "Terminal disconnected.",
    });

    expect(combineTerminalSessionState(summary, attached)).toMatchObject({
      status: "error",
      error: "Terminal disconnected.",
      version: 1,
    });
  });

  it("uses metadata status before an attach stream has emitted", () => {
    const summary = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          owner: BASE_SNAPSHOT.owner,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: "running",
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: BASE_SNAPSHOT.updatedAt,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    })[0]!;

    expect(combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE).status).toBe(
      "running",
    );
  });

  it("does not treat an idle running shell as a running subprocess", () => {
    const idleSession = {
      target: TARGET,
      state: {
        ...combineTerminalSessionState(null, EMPTY_TERMINAL_BUFFER_STATE),
        status: "running" as const,
        hasRunningSubprocess: false,
      },
    };
    const activeSession = {
      target: { ...TARGET, terminalId: "term-2" },
      state: {
        ...idleSession.state,
        hasRunningSubprocess: true,
      },
    };

    expect(selectRunningSubprocessTerminalIds([idleSession, activeSession])).toEqual(["term-2"]);
  });

  it("reduces attach snapshots and output without an imperative session manager", () => {
    const snapshot = applyTerminalAttachStreamEvent(EMPTY_TERMINAL_BUFFER_STATE, {
      type: "snapshot",
      snapshot: BASE_SNAPSHOT,
    });
    const output = applyTerminalAttachStreamEvent(
      snapshot,
      {
        type: "output",
        owner: TARGET.owner,
        terminalId: TARGET.terminalId,
        data: " world",
      },
      8,
    );

    expect(output).toMatchObject({
      buffer: "lo world",
      status: "running",
      error: null,
      version: 2,
    });
  });

  it("reduces terminal metadata snapshots, upserts, and removals", () => {
    const initial = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          owner: BASE_SNAPSHOT.owner,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: BASE_SNAPSHOT.status,
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: BASE_SNAPSHOT.updatedAt,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    });
    const updated = applyTerminalMetadataStreamEvent(initial, {
      type: "upsert",
      terminal: {
        ...initial[0]!,
        hasRunningSubprocess: true,
      },
    });
    const removed = applyTerminalMetadataStreamEvent(updated, {
      type: "remove",
      owner: TARGET.owner,
      terminalId: TARGET.terminalId,
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.hasRunningSubprocess).toBe(true);
    expect(removed).toEqual([]);
  });

  it("keys metadata by owner so project and thread terminals do not collide", () => {
    const withThread = applyTerminalMetadataStreamEvent([], {
      type: "upsert",
      terminal: {
        owner: OWNER,
        terminalId: TARGET.terminalId,
        cwd: BASE_SNAPSHOT.cwd,
        worktreePath: BASE_SNAPSHOT.worktreePath,
        status: BASE_SNAPSHOT.status,
        pid: BASE_SNAPSHOT.pid,
        exitCode: BASE_SNAPSHOT.exitCode,
        exitSignal: BASE_SNAPSHOT.exitSignal,
        updatedAt: BASE_SNAPSHOT.updatedAt,
        hasRunningSubprocess: false,
        label: BASE_SNAPSHOT.label,
      },
    });
    const withBoth = applyTerminalMetadataStreamEvent(withThread, {
      type: "upsert",
      terminal: {
        owner: PROJECT_OWNER,
        terminalId: TARGET.terminalId,
        cwd: BASE_SNAPSHOT.cwd,
        worktreePath: BASE_SNAPSHOT.worktreePath,
        status: BASE_SNAPSHOT.status,
        pid: BASE_SNAPSHOT.pid,
        exitCode: BASE_SNAPSHOT.exitCode,
        exitSignal: BASE_SNAPSHOT.exitSignal,
        updatedAt: BASE_SNAPSHOT.updatedAt,
        hasRunningSubprocess: false,
        label: BASE_SNAPSHOT.label,
      },
    });
    const afterRemoveProject = applyTerminalMetadataStreamEvent(withBoth, {
      type: "remove",
      owner: PROJECT_OWNER,
      terminalId: TARGET.terminalId,
    });

    expect(withBoth).toHaveLength(2);
    expect(afterRemoveProject).toHaveLength(1);
    expect(afterRemoveProject[0]?.owner).toEqual(OWNER);
  });

  it("caps retained output by UTF-8 byte length", () => {
    const state = applyTerminalAttachStreamEvent(
      EMPTY_TERMINAL_BUFFER_STATE,
      {
        type: "output",
        owner: TARGET.owner,
        terminalId: TARGET.terminalId,
        data: "🙂🙂",
      },
      4,
    );

    expect(state.buffer).toBe("🙂");
  });
});
