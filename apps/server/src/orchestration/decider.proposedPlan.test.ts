import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

const seedReadModelWithProject = Effect.gen(function* () {
  const now = "2026-01-01T00:00:00.000Z";
  const initial = createEmptyReadModel(now);
  return yield* projectEvent(initial, {
    sequence: 1,
    eventId: asEventId("evt-project-create"),
    aggregateKind: "project",
    aggregateId: asProjectId("project-proposedplan"),
    type: "project.created",
    occurredAt: now,
    commandId: asCommandId("cmd-project-create"),
    causationEventId: null,
    correlationId: asCommandId("cmd-project-create"),
    metadata: {},
    payload: {
      projectId: asProjectId("project-proposedplan"),
      title: "Project ProposedPlan",
      workspaceRoot: "/tmp/project-proposedplan",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });
});

const seedReadModelWithThreadAndMessages = (projectReadModel: OrchestrationReadModel) =>
  Effect.gen(function* () {
    const now = "2026-01-01T00:00:00.000Z";
    let readModel = projectReadModel;
    let sequence = projectReadModel.snapshotSequence + 1;

    readModel = yield* projectEvent(readModel, {
      sequence,
      eventId: asEventId("evt-thread-create"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-proposedplan"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-thread-create"),
      causationEventId: null,
      correlationId: asCommandId("cmd-thread-create"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-proposedplan"),
        projectId: asProjectId("project-proposedplan"),
        title: "Thread ProposedPlan",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    sequence += 1;

    readModel = yield* projectEvent(readModel, {
      sequence,
      eventId: asEventId("evt-message-sent-1"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-proposedplan"),
      type: "thread.message-sent",
      occurredAt: now,
      commandId: asCommandId("cmd-message-send-1"),
      causationEventId: null,
      correlationId: asCommandId("cmd-message-send-1"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-proposedplan"),
        messageId: asMessageId("msg-user-1"),
        role: "user",
        text: "What should we do?",
        attachments: [],
        turnId: asTurnId("turn-1"),
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    });
    sequence += 1;

    readModel = yield* projectEvent(readModel, {
      sequence,
      eventId: asEventId("evt-message-sent-2"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-proposedplan"),
      type: "thread.message-sent",
      occurredAt: now,
      commandId: asCommandId("cmd-message-send-2"),
      causationEventId: null,
      correlationId: asCommandId("cmd-message-send-2"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-proposedplan"),
        messageId: asMessageId("msg-assistant-1"),
        role: "assistant",
        text: "Here's a plan:\n1. Do this\n2. Then that",
        attachments: [],
        turnId: asTurnId("turn-1"),
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    });
    sequence += 1;

    readModel = yield* projectEvent(readModel, {
      sequence,
      eventId: asEventId("evt-message-sent-3"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-proposedplan"),
      type: "thread.message-sent",
      occurredAt: now,
      commandId: asCommandId("cmd-message-send-3"),
      causationEventId: null,
      correlationId: asCommandId("cmd-message-send-3"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-proposedplan"),
        messageId: asMessageId("msg-user-2"),
        role: "user",
        text: "Can we improve it?",
        attachments: [],
        turnId: asTurnId("turn-2"),
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    });
    sequence += 1;

    readModel = yield* projectEvent(readModel, {
      sequence,
      eventId: asEventId("evt-message-sent-4"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-proposedplan"),
      type: "thread.message-sent",
      occurredAt: now,
      commandId: asCommandId("cmd-message-send-4"),
      causationEventId: null,
      correlationId: asCommandId("cmd-message-send-4"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-proposedplan"),
        messageId: asMessageId("msg-assistant-2"),
        role: "assistant",
        text: "Updated plan:\n1. Do this first\n2. Then that\n3. Finally this",
        attachments: [],
        turnId: asTurnId("turn-2"),
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    });

    return readModel;
  });

it.layer(NodeServices.layer)("proposed plan promote command", (it) => {
  it.effect("promotes the latest eligible assistant message", () =>
    Effect.gen(function* () {
      const projectReadModel = yield* seedReadModelWithProject;
      const readModel = yield* seedReadModelWithThreadAndMessages(projectReadModel);

      const promoteCommand: OrchestrationCommand = {
        type: "thread.proposed-plan.promote",
        commandId: asCommandId("cmd-promote"),
        threadId: asThreadId("thread-proposedplan"),
        createdAt: "2026-01-01T00:00:01.000Z",
      };

      const decided = yield* decideOrchestrationCommand({
        command: promoteCommand,
        readModel,
      });

      const event = Array.isArray(decided) ? decided[0] : decided;
      expect(event).toBeDefined();
      expect(event.type).toBe("thread.proposed-plan-upserted");
      expect(event.aggregateKind).toBe("thread");
      expect(event.aggregateId).toBe(asThreadId("thread-proposedplan"));

      if (event.type === "thread.proposed-plan-upserted") {
        const plan = event.payload.proposedPlan;
        expect(plan.planMarkdown).toBe(
          "Updated plan:\n1. Do this first\n2. Then that\n3. Finally this",
        );
        expect(plan.turnId).toBe(asTurnId("turn-2"));
        expect(plan.id).toMatch(/^plan:thread-proposedplan:promoted:msg-assistant-2$/);
      }
    }),
  );

  it.effect("returns error when no eligible assistant message exists", () =>
    Effect.gen(function* () {
      const projectReadModel = yield* seedReadModelWithProject;
      const now = "2026-01-01T00:00:00.000Z";

      const readModel = yield* projectEvent(projectReadModel, {
        sequence: projectReadModel.snapshotSequence + 1,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-empty"),
        type: "thread.created",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-create"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-empty"),
          projectId: asProjectId("project-proposedplan"),
          title: "Thread Empty",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const promoteCommand: OrchestrationCommand = {
        type: "thread.proposed-plan.promote",
        commandId: asCommandId("cmd-promote-empty"),
        threadId: asThreadId("thread-empty"),
        createdAt: "2026-01-01T00:00:01.000Z",
      };

      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: promoteCommand,
          readModel,
        }),
      );
      expect(error.message).toContain("No assistant message available to promote");
    }),
  );

  it.effect("returns error when no assistant message has non-empty text", () =>
    Effect.gen(function* () {
      const projectReadModel = yield* seedReadModelWithProject;
      let readModel = projectReadModel;
      let sequence = projectReadModel.snapshotSequence + 1;
      const now = "2026-01-01T00:00:00.000Z";

      readModel = yield* projectEvent(readModel, {
        sequence,
        eventId: asEventId("evt-thread-create-2"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-empty-messages"),
        type: "thread.created",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-create-2"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-create-2"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-empty-messages"),
          projectId: asProjectId("project-proposedplan"),
          title: "Thread Empty Messages",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      sequence += 1;

      readModel = yield* projectEvent(readModel, {
        sequence,
        eventId: asEventId("evt-message-sent-user"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-empty-messages"),
        type: "thread.message-sent",
        occurredAt: now,
        commandId: asCommandId("cmd-message-send-user"),
        causationEventId: null,
        correlationId: asCommandId("cmd-message-send-user"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-empty-messages"),
          messageId: asMessageId("msg-user-empty"),
          role: "user",
          text: "Hello?",
          attachments: [],
          turnId: asTurnId("turn-3"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });
      sequence += 1;

      readModel = yield* projectEvent(readModel, {
        sequence,
        eventId: asEventId("evt-message-sent-assistant-empty"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-empty-messages"),
        type: "thread.message-sent",
        occurredAt: now,
        commandId: asCommandId("cmd-message-send-assistant-empty"),
        causationEventId: null,
        correlationId: asCommandId("cmd-message-send-assistant-empty"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-empty-messages"),
          messageId: asMessageId("msg-assistant-empty"),
          role: "assistant",
          text: "   \n\t  ",
          attachments: [],
          turnId: asTurnId("turn-3"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      const promoteCommand: OrchestrationCommand = {
        type: "thread.proposed-plan.promote",
        commandId: asCommandId("cmd-promote-empty-text"),
        threadId: asThreadId("thread-empty-messages"),
        createdAt: "2026-01-01T00:00:02.000Z",
      };

      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: promoteCommand,
          readModel,
        }),
      );
      expect(error.message).toContain("No assistant message available to promote");
    }),
  );

  it.effect("picks M1 when a revert retains only turn T1 (M2 from T2 has been pruned)", () =>
    Effect.gen(function* () {
      const projectReadModel = yield* seedReadModelWithProject;
      const fullReadModel = yield* seedReadModelWithThreadAndMessages(projectReadModel);

      const fullThread = fullReadModel.threads.find(
        (t) => t.id === asThreadId("thread-proposedplan"),
      );
      if (!fullThread) throw new Error("expected seeded thread");

      const retainedMessages = fullThread.messages.filter(
        (entry) => entry.turnId === asTurnId("turn-1"),
      );
      const readModel: OrchestrationReadModel = {
        ...fullReadModel,
        threads: fullReadModel.threads.map((entry) =>
          entry.id === fullThread.id ? { ...entry, messages: retainedMessages } : entry,
        ),
      };

      const promoteCommand: OrchestrationCommand = {
        type: "thread.proposed-plan.promote",
        commandId: asCommandId("cmd-promote-after-revert"),
        threadId: asThreadId("thread-proposedplan"),
        createdAt: "2026-01-01T00:00:02.000Z",
      };

      const decided = yield* decideOrchestrationCommand({
        command: promoteCommand,
        readModel,
      });

      const event = Array.isArray(decided) ? decided[0] : decided;
      expect(event).toBeDefined();
      expect(event.type).toBe("thread.proposed-plan-upserted");

      if (event.type === "thread.proposed-plan-upserted") {
        expect(event.payload.proposedPlan.id).toBe(
          "plan:thread-proposedplan:promoted:msg-assistant-1",
        );
        expect(event.payload.proposedPlan.turnId).toBe(asTurnId("turn-1"));
        expect(event.payload.proposedPlan.planMarkdown).toBe(
          "Here's a plan:\n1. Do this\n2. Then that",
        );
      }
    }),
  );
});
