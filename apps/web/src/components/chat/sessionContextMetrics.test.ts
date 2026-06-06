import {
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThreadActivity,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ChatMessage,
  type Thread,
} from "~/types";
import { getSessionContextMetrics } from "./sessionContextMetrics";

const environmentId = EnvironmentId.make("env-1");
const instanceId = ProviderInstanceId.make("codex");

function makeMessage(role: ChatMessage["role"], text: string, suffix: string): ChatMessage {
  return {
    id: MessageId.make(`msg-${suffix}`),
    role,
    text,
    createdAt: `2026-01-01T00:00:${suffix.padStart(2, "0")}Z`,
    streaming: false,
  };
}

function makeContextWindowActivity(
  payload: Record<string, number | boolean>,
  createdAt = "2026-01-01T00:00:05Z",
  id = "activity-1",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind: "context-window.updated",
    summary: "context",
    payload,
    turnId: null,
    createdAt,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId,
    codexThreadId: null,
    projectId: ProjectId.make("project-1"),
    title: "Test Thread",
    modelSelection: {
      instanceId,
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeProvider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex Primary",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "unknown" },
    checkedAt: "2026-01-01T00:00:00Z",
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
    ...overrides,
  } as ServerProvider;
}

describe("sessionContextMetrics", () => {
  it("extracts metrics from the latest assistant turn snapshot", () => {
    const thread = makeThread({
      messages: [
        makeMessage("user", "hi", "1"),
        makeMessage("assistant", "hello", "2"),
        makeMessage("user", "ok", "3"),
      ],
      activities: [
        makeContextWindowActivity(
          {
            usedTokens: 50,
            maxTokens: 1000,
            lastInputTokens: 10,
            lastOutputTokens: 20,
            lastReasoningOutputTokens: 5,
            lastCachedInputTokens: 7,
          },
          "2026-01-01T00:00:04Z",
          "activity-old",
        ),
        makeContextWindowActivity(
          {
            usedTokens: 1500,
            maxTokens: 10_000,
            lastInputTokens: 500,
            lastOutputTokens: 300,
            lastReasoningOutputTokens: 50,
            lastCachedInputTokens: 100,
          },
          "2026-01-01T00:00:10Z",
          "activity-latest",
        ),
      ],
    });

    const metrics = getSessionContextMetrics(thread, [makeProvider()]);

    expect(metrics.input).toBe(500);
    expect(metrics.output).toBe(300);
    expect(metrics.reasoning).toBe(50);
    expect(metrics.cacheRead).toBe(100);
    expect(metrics.total).toBe(1500);
    expect(metrics.limit).toBe(10_000);
    expect(metrics.usage).toBe(15);
    expect(metrics.lastActivityAt).toBe("2026-01-01T00:00:10Z");
  });

  it("falls back to cumulative token fields when last* fields are absent", () => {
    const thread = makeThread({
      activities: [
        makeContextWindowActivity({
          usedTokens: 50_000,
          maxTokens: 200_000,
          inputTokens: 30_000,
          outputTokens: 15_000,
          cachedInputTokens: 4_500,
        }),
      ],
    });
    const metrics = getSessionContextMetrics(thread, [makeProvider()]);
    expect(metrics.input).toBe(30_000);
    expect(metrics.output).toBe(15_000);
    expect(metrics.cacheRead).toBe(4_500);
    expect(metrics.total).toBe(50_000);
    expect(metrics.usage).toBe(25);
  });

  it("returns null token fields when no snapshot exists", () => {
    const thread = makeThread();
    const metrics = getSessionContextMetrics(thread, [makeProvider()]);
    expect(metrics.input).toBeNull();
    expect(metrics.output).toBeNull();
    expect(metrics.total).toBeNull();
    expect(metrics.limit).toBeNull();
    expect(metrics.usage).toBeNull();
  });

  it("falls back to slug when provider/model cannot be resolved", () => {
    const thread = makeThread({
      modelSelection: {
        instanceId: ProviderInstanceId.make("unknown-instance"),
        model: "mystery-model",
      },
    });
    const metrics = getSessionContextMetrics(thread, []);
    expect(metrics.providerLabel).toBe("unknown-instance");
    expect(metrics.modelLabel).toBe("mystery-model");
  });

  it("returns null usage when maxTokens is missing", () => {
    const thread = makeThread({
      activities: [
        makeContextWindowActivity({
          usedTokens: 1000,
          lastInputTokens: 500,
        }),
      ],
    });
    const metrics = getSessionContextMetrics(thread, [makeProvider()]);
    expect(metrics.usage).toBeNull();
    expect(metrics.limit).toBeNull();
  });

  it("splits message counts by role", () => {
    const thread = makeThread({
      messages: [
        makeMessage("user", "1", "1"),
        makeMessage("assistant", "2", "2"),
        makeMessage("user", "3", "3"),
        makeMessage("assistant", "4", "4"),
        makeMessage("assistant", "5", "5"),
      ],
    });
    const metrics = getSessionContextMetrics(thread, [makeProvider()]);
    expect(metrics.userMessageCount).toBe(2);
    expect(metrics.assistantMessageCount).toBe(3);
    expect(metrics.messageCount).toBe(5);
  });
});
