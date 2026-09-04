import { describe, expect, it } from "vite-plus/test";
import {
  countChatFindOccurrences,
  deriveChatFindMatches,
  resolveChatFindActiveIndex,
  resolveChatFindStartIndex,
  stepChatFindIndex,
} from "./ChatFindBar.logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

function messageRow(id: string, role: "user" | "assistant", text: string): MessagesTimelineRow {
  return {
    kind: "message",
    id,
    createdAt: "2026-01-01T00:00:00Z",
    message: {
      id: id as never,
      role,
      text,
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      streaming: false,
    },
    durationStart: "2026-01-01T00:00:00Z",
    showAssistantMeta: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
  };
}

const foldRow: MessagesTimelineRow = {
  kind: "turn-fold",
  id: "turn-fold:turn-1",
  createdAt: "2026-01-01T00:00:00Z",
  turnId: "turn-1" as never,
  label: "Worked for 3s on error handling",
  expanded: false,
};

const rows: MessagesTimelineRow[] = [
  messageRow("user-1", "user", "Fix the Error in the parser"),
  foldRow,
  messageRow("assistant-1", "assistant", "No error here."),
  messageRow("user-2", "user", "still broken"),
  messageRow("assistant-2", "assistant", "Found the error; the ERROR was a typo. error fixed."),
];

describe("countChatFindOccurrences", () => {
  it("counts case-insensitive, non-overlapping occurrences", () => {
    expect(countChatFindOccurrences("Error error ERROR", "error")).toBe(3);
    expect(countChatFindOccurrences("aaaa", "aa")).toBe(2);
    expect(countChatFindOccurrences("nothing", "error")).toBe(0);
    expect(countChatFindOccurrences("anything", "")).toBe(0);
  });
});

describe("deriveChatFindMatches", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(deriveChatFindMatches(rows, "")).toEqual([]);
    expect(deriveChatFindMatches(rows, "   ")).toEqual([]);
  });

  it("lists one match per occurrence in timeline order and skips non-message rows", () => {
    expect(deriveChatFindMatches(rows, " error ")).toEqual([
      { rowId: "user-1", rowIndex: 0, occurrence: 0 },
      { rowId: "assistant-1", rowIndex: 2, occurrence: 0 },
      { rowId: "assistant-2", rowIndex: 4, occurrence: 0 },
      { rowId: "assistant-2", rowIndex: 4, occurrence: 1 },
      { rowId: "assistant-2", rowIndex: 4, occurrence: 2 },
    ]);
    expect(deriveChatFindMatches(rows, "Worked for")).toEqual([]);
  });
});

describe("stepChatFindIndex", () => {
  it("wraps in both directions and tolerates a single match", () => {
    expect(stepChatFindIndex(0, 3, 1)).toBe(1);
    expect(stepChatFindIndex(2, 3, 1)).toBe(0);
    expect(stepChatFindIndex(0, 3, -1)).toBe(2);
    expect(stepChatFindIndex(0, 1, 1)).toBe(0);
    expect(stepChatFindIndex(0, 1, -1)).toBe(0);
    expect(stepChatFindIndex(4, 0, 1)).toBe(0);
  });
});

describe("resolveChatFindActiveIndex", () => {
  const matches = deriveChatFindMatches(rows, "error");

  it("follows the same occurrence when rows shift underneath it", () => {
    const previous = matches[3]!;
    const shifted = deriveChatFindMatches([messageRow("user-0", "user", "hi"), ...rows], "error");
    expect(resolveChatFindActiveIndex(shifted, 3, previous)).toBe(3);
    expect(shifted[3]).toEqual({ rowId: "assistant-2", rowIndex: 5, occurrence: 1 });
  });

  it("clamps when the previous occurrence is gone", () => {
    const previous = matches[4]!;
    const fewer = deriveChatFindMatches(rows.slice(0, 3), "error");
    expect(resolveChatFindActiveIndex(fewer, 4, previous)).toBe(1);
    expect(resolveChatFindActiveIndex([], 4, previous)).toBe(0);
    expect(resolveChatFindActiveIndex(matches, -2, null)).toBe(0);
  });
});

describe("resolveChatFindStartIndex", () => {
  const matches = deriveChatFindMatches(rows, "error");

  it("starts at the first match at or after the visible row", () => {
    expect(resolveChatFindStartIndex(matches, null)).toBe(0);
    expect(resolveChatFindStartIndex(matches, 0)).toBe(0);
    expect(resolveChatFindStartIndex(matches, 1)).toBe(1);
    expect(resolveChatFindStartIndex(matches, 3)).toBe(2);
  });

  it("falls back to the first match when nothing follows the visible row", () => {
    expect(resolveChatFindStartIndex(matches, 10)).toBe(0);
  });
});
