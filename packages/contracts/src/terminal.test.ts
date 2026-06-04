import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_TERMINAL_ID,
  TerminalAttachInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalOwner,
  TerminalResizeInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
  terminalOwnerLabel,
} from "./terminal.ts";

function decodeSync<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
}

function decodes<S extends Schema.Top>(schema: S, input: unknown): boolean {
  try {
    Schema.decodeUnknownSync(schema as never)(input);
    return true;
  } catch {
    return false;
  }
}

const threadOwner = { type: "thread", threadId: "thread-1" } as const;

describe("TerminalOpenInput", () => {
  it("accepts valid open input", () => {
    expect(
      decodes(TerminalOpenInput, {
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        cwd: "/tmp/project",
        cols: 120,
        rows: 40,
      }),
    ).toBe(true);
  });

  it("accepts ultrawide terminal dimensions from xterm fit", () => {
    expect(
      decodes(TerminalOpenInput, {
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        cwd: "/tmp/project",
        cols: 423,
        rows: 40,
      }),
    ).toBe(true);
  });

  it("rejects invalid bounds", () => {
    expect(
      decodes(TerminalOpenInput, {
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        cwd: "/tmp/project",
        cols: 10,
        rows: 0,
      }),
    ).toBe(false);
  });

  it("requires terminalId — the client must always pick an id", () => {
    expect(
      decodes(TerminalOpenInput, {
        owner: threadOwner,
        cwd: "/tmp/project",
        cols: 100,
        rows: 24,
      }),
    ).toBe(false);
  });

  it("accepts optional env overrides", () => {
    const parsed = decodeSync(TerminalOpenInput, {
      owner: threadOwner,
      terminalId: DEFAULT_TERMINAL_ID,
      cwd: "/tmp/project",
      worktreePath: "/tmp/project/.t3/worktrees/feature-a",
      cols: 100,
      rows: 24,
      env: {
        T3CODE_PROJECT_ROOT: "/tmp/project",
        CUSTOM_FLAG: "1",
      },
    });
    expect(parsed.env).toMatchObject({
      T3CODE_PROJECT_ROOT: "/tmp/project",
      CUSTOM_FLAG: "1",
    });
    expect(parsed.worktreePath).toBe("/tmp/project/.t3/worktrees/feature-a");
  });

  it("rejects invalid env keys", () => {
    expect(
      decodes(TerminalOpenInput, {
        owner: threadOwner,
        cwd: "/tmp/project",
        cols: 100,
        rows: 24,
        env: {
          "bad-key": "1",
        },
      }),
    ).toBe(false);
  });
});

describe("TerminalAttachInput", () => {
  it("accepts explicit inactive-session restart intent", () => {
    const parsed = decodeSync(TerminalAttachInput, {
      owner: threadOwner,
      terminalId: DEFAULT_TERMINAL_ID,
      cwd: "/tmp/project",
      restartIfNotRunning: true,
    });

    expect(parsed.restartIfNotRunning).toBe(true);
  });
});

describe("TerminalWriteInput", () => {
  it("accepts non-empty data", () => {
    expect(
      decodes(TerminalWriteInput, {
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        data: "echo hello\n",
      }),
    ).toBe(true);
  });

  it("rejects empty data", () => {
    expect(
      decodes(TerminalWriteInput, {
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        data: "",
      }),
    ).toBe(false);
  });

  it("rejects missing terminalId", () => {
    expect(
      decodes(TerminalWriteInput, {
        owner: threadOwner,
        data: "echo hello\n",
      }),
    ).toBe(false);
  });
});

describe("TerminalOwner", () => {
  it("trims thread ids", () => {
    const parsed = decodeSync(TerminalOwner, { type: "thread", threadId: " thread-1 " });
    expect(parsed.type === "thread" && parsed.threadId).toBe("thread-1");
  });

  it("accepts project owners", () => {
    const parsed = decodeSync(TerminalOwner, { type: "project", projectId: "project-1" });
    expect(parsed.type === "project" && parsed.projectId).toBe("project-1");
  });

  it("labels owners", () => {
    expect(terminalOwnerLabel({ type: "thread", threadId: "thread-1" })).toBe("thread: thread-1");
    expect(terminalOwnerLabel({ type: "project", projectId: "project-1" })).toBe(
      "project: project-1",
    );
  });
});

describe("TerminalResizeInput", () => {
  it("accepts valid size", () => {
    expect(
      decodes(TerminalResizeInput, {
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        cols: 80,
        rows: 24,
      }),
    ).toBe(true);
  });

  it("rejects missing terminalId", () => {
    expect(
      decodes(TerminalResizeInput, {
        owner: threadOwner,
        cols: 80,
        rows: 24,
      }),
    ).toBe(false);
  });
});

describe("TerminalClearInput", () => {
  it("requires terminalId", () => {
    expect(decodes(TerminalClearInput, { owner: threadOwner })).toBe(false);
  });

  it("accepts an explicit terminalId", () => {
    const parsed = decodeSync(TerminalClearInput, {
      owner: threadOwner,
      terminalId: DEFAULT_TERMINAL_ID,
    });
    expect(parsed.terminalId).toBe(DEFAULT_TERMINAL_ID);
  });
});

describe("TerminalCloseInput", () => {
  it("accepts optional deleteHistory", () => {
    expect(
      decodes(TerminalCloseInput, {
        owner: threadOwner,
        deleteHistory: true,
      }),
    ).toBe(true);
  });
});

describe("TerminalSessionSnapshot", () => {
  const isoTimestamp = "2026-01-01T00:00:00.000Z";

  it("accepts running snapshots", () => {
    expect(
      decodes(TerminalSessionSnapshot, {
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        cwd: "/tmp/project",
        worktreePath: null,
        status: "running",
        pid: 1234,
        history: "hello\n",
        exitCode: null,
        exitSignal: null,
        label: "Primary",
        updatedAt: isoTimestamp,
      }),
    ).toBe(true);
  });
});

describe("TerminalEvent", () => {
  const isoTimestamp = "2026-01-01T00:00:00.000Z";

  it("accepts output events", () => {
    expect(
      decodes(TerminalEvent, {
        type: "output",
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        data: "line\n",
      }),
    ).toBe(true);
  });

  it("accepts exited events", () => {
    expect(
      decodes(TerminalEvent, {
        type: "exited",
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        exitCode: 0,
        exitSignal: null,
      }),
    ).toBe(true);
  });

  it("accepts closed events", () => {
    expect(
      decodes(TerminalEvent, {
        type: "closed",
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
      }),
    ).toBe(true);
  });

  it("accepts activity events", () => {
    expect(
      decodes(TerminalEvent, {
        type: "activity",
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        hasRunningSubprocess: true,
        label: "vim",
      }),
    ).toBe(true);
  });

  it("accepts started events with snapshot worktree metadata", () => {
    expect(
      decodes(TerminalEvent, {
        type: "started",
        owner: threadOwner,
        terminalId: DEFAULT_TERMINAL_ID,
        snapshot: {
          owner: threadOwner,
          terminalId: DEFAULT_TERMINAL_ID,
          cwd: "/tmp/project/.t3/worktrees/feature-a",
          worktreePath: "/tmp/project/.t3/worktrees/feature-a",
          status: "running",
          pid: 1234,
          history: "",
          exitCode: null,
          exitSignal: null,
          label: "Primary",
          updatedAt: isoTimestamp,
        },
      }),
    ).toBe(true);
  });
});
