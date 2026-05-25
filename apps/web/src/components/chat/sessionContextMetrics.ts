import type { ServerProvider } from "@t3tools/contracts";
import { deriveLatestContextWindowSnapshot } from "~/lib/contextWindow";
import type { Thread } from "~/types";

export interface SessionContextMetrics {
  sessionTitle: string;
  providerLabel: string;
  modelLabel: string;
  limit: number | null;
  input: number | null;
  output: number | null;
  reasoning: number | null;
  cacheRead: number | null;
  total: number | null;
  usage: number | null;
  userMessageCount: number;
  assistantMessageCount: number;
  messageCount: number;
  sessionCreatedAt: string;
  lastActivityAt: string | null;
}

export function getSessionContextMetrics(
  thread: Thread,
  providers: ReadonlyArray<ServerProvider>,
): SessionContextMetrics {
  const snapshot = deriveLatestContextWindowSnapshot(thread.activities);

  const provider = providers.find(
    (candidate) => candidate.instanceId === thread.modelSelection.instanceId,
  );
  const modelSlug = thread.modelSelection.model;
  const model = provider?.models.find((candidate) => candidate.slug === modelSlug);

  const providerLabel =
    provider?.displayName?.trim() || provider?.driver || thread.modelSelection.instanceId;
  const modelLabel = model?.name?.trim() || modelSlug;

  const input = snapshot?.lastInputTokens ?? snapshot?.inputTokens ?? null;
  const output = snapshot?.lastOutputTokens ?? snapshot?.outputTokens ?? null;
  const reasoning = snapshot?.lastReasoningOutputTokens ?? snapshot?.reasoningOutputTokens ?? null;
  const cacheRead = snapshot?.lastCachedInputTokens ?? snapshot?.cachedInputTokens ?? null;

  const limit = snapshot?.maxTokens ?? null;
  const usedTokens = snapshot?.usedTokens ?? null;
  const hasAnyToken =
    input !== null || output !== null || reasoning !== null || cacheRead !== null;
  const total =
    usedTokens ??
    (hasAnyToken ? (input ?? 0) + (output ?? 0) + (reasoning ?? 0) + (cacheRead ?? 0) : null);
  const usage =
    limit !== null && limit > 0 && usedTokens !== null && usedTokens > 0
      ? Math.round((usedTokens / limit) * 100)
      : null;

  let userMessageCount = 0;
  let assistantMessageCount = 0;
  for (const message of thread.messages) {
    if (message.role === "user") userMessageCount += 1;
    else if (message.role === "assistant") assistantMessageCount += 1;
  }

  const lastActivity = thread.activities[thread.activities.length - 1];
  const lastMessage = thread.messages[thread.messages.length - 1];
  const lastActivityAt = lastActivity?.createdAt ?? lastMessage?.createdAt ?? null;

  return {
    sessionTitle: thread.title,
    providerLabel,
    modelLabel,
    limit,
    input,
    output,
    reasoning,
    cacheRead,
    total,
    usage,
    userMessageCount,
    assistantMessageCount,
    messageCount: thread.messages.length,
    sessionCreatedAt: thread.createdAt,
    lastActivityAt,
  };
}
