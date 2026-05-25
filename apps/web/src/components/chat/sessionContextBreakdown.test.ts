import { EventId, MessageId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "~/types";
import { estimateSessionContextBreakdown } from "./sessionContextBreakdown";

let idCounter = 0;
function makeMessage(role: ChatMessage["role"], text: string): ChatMessage {
  idCounter += 1;
  return {
    id: MessageId.make(`msg-${idCounter}`),
    role,
    text,
    createdAt: "2026-01-01T00:00:00Z",
    streaming: false,
  };
}

function makeToolActivity(
  kind: "tool.started" | "tool.updated" | "tool.completed",
  payload: unknown,
  id = `act-${idCounter++}`,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "tool",
    kind,
    summary: kind,
    payload,
    turnId: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("sessionContextBreakdown", () => {
  it("estimates token counts from character lengths per role", () => {
    const breakdown = estimateSessionContextBreakdown({
      messages: [makeMessage("user", "a".repeat(400)), makeMessage("assistant", "b".repeat(800))],
      activities: [],
      input: 1000,
    });
    const user = breakdown.find((s) => s.key === "user");
    const assistant = breakdown.find((s) => s.key === "assistant");
    expect(user?.tokens).toBe(100);
    expect(assistant?.tokens).toBe(200);
  });

  it("includes the system prompt length in the system segment", () => {
    const breakdown = estimateSessionContextBreakdown({
      messages: [],
      activities: [],
      systemPrompt: "x".repeat(40),
      input: 1000,
    });
    const system = breakdown.find((s) => s.key === "system");
    expect(system?.tokens).toBe(10);
  });

  it("counts tool activities by JSON payload length", () => {
    const payload = { name: "edit", args: "y".repeat(396) };
    const activities = [makeToolActivity("tool.started", payload)];
    const expected = Math.ceil(JSON.stringify(payload).length / 4);
    const breakdown = estimateSessionContextBreakdown({
      messages: [],
      activities,
      input: 5000,
    });
    expect(breakdown.find((s) => s.key === "tool")?.tokens).toBe(expected);
  });

  it("ignores non-tool activities for the tool segment", () => {
    const activities: OrchestrationThreadActivity[] = [
      {
        id: EventId.make("act-other"),
        tone: "info",
        kind: "context-window.updated",
        summary: "ctx",
        payload: { usedTokens: 100 },
        turnId: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const breakdown = estimateSessionContextBreakdown({
      messages: [],
      activities,
      input: 1000,
    });
    expect(breakdown.find((s) => s.key === "tool")).toBeUndefined();
  });

  it("fills remainder into the other segment when estimated tokens fit", () => {
    const breakdown = estimateSessionContextBreakdown({
      messages: [makeMessage("user", "hello")],
      activities: [],
      input: 1000,
    });
    const other = breakdown.find((s) => s.key === "other");
    expect(other).toBeDefined();
    const totalTokens = breakdown.reduce((sum, s) => sum + s.tokens, 0);
    expect(totalTokens).toBe(1000);
  });

  it("scales segments proportionally when estimated exceeds input", () => {
    const breakdown = estimateSessionContextBreakdown({
      messages: [
        makeMessage("user", "a".repeat(10_000)),
        makeMessage("assistant", "b".repeat(10_000)),
      ],
      activities: [],
      input: 1000,
    });
    const total = breakdown.reduce((sum, s) => sum + s.tokens, 0);
    expect(total).toBe(1000);
    expect(breakdown.find((s) => s.key === "user")?.tokens ?? 0).toBeGreaterThan(0);
    expect(breakdown.find((s) => s.key === "assistant")?.tokens ?? 0).toBeGreaterThan(0);
  });

  it("filters out zero-token segments", () => {
    const breakdown = estimateSessionContextBreakdown({
      messages: [makeMessage("user", "hi")],
      activities: [],
      input: 1000,
    });
    expect(breakdown.every((s) => s.tokens > 0)).toBe(true);
    expect(breakdown.find((s) => s.key === "assistant")).toBeUndefined();
  });

  it("returns empty array when there is no data and no input budget", () => {
    const breakdown = estimateSessionContextBreakdown({
      messages: [],
      activities: [],
      input: null,
    });
    expect(breakdown).toEqual([]);
  });

  it("emits widths matching the per-segment ratios", () => {
    const breakdown = estimateSessionContextBreakdown({
      messages: [makeMessage("user", "a".repeat(400)), makeMessage("assistant", "b".repeat(400))],
      activities: [],
      input: 1000,
    });
    const total = breakdown.reduce((sum, s) => sum + s.tokens, 0);
    for (const segment of breakdown) {
      const expected = (segment.tokens / total) * 100;
      expect(Math.abs(segment.width - expected)).toBeLessThan(1e-6);
    }
  });
});
