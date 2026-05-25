import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import type { ChatMessage } from "~/types";

export type SessionContextBreakdownKey = "system" | "user" | "assistant" | "tool" | "other";

export interface SessionContextBreakdownSegment {
  key: SessionContextBreakdownKey;
  tokens: number;
  width: number;
  percent: number;
}

const CHARS_PER_TOKEN = 4;
const ORDERED_KEYS: SessionContextBreakdownKey[] = ["system", "user", "assistant", "tool", "other"];

function charsToTokens(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export function estimateSessionContextBreakdown(input: {
  messages: ReadonlyArray<ChatMessage>;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  systemPrompt?: string | null;
  input: number | null;
}): SessionContextBreakdownSegment[] {
  const { messages, activities, systemPrompt, input: inputTokens } = input;

  let systemChars = systemPrompt?.length ?? 0;
  let userChars = 0;
  let assistantChars = 0;
  for (const message of messages) {
    const length = message.text?.length ?? 0;
    if (message.role === "user") userChars += length;
    else if (message.role === "assistant") assistantChars += length;
    else if (message.role === "system") systemChars += length;
  }

  let toolChars = 0;
  for (const activity of activities) {
    if (
      activity.kind === "tool.started" ||
      activity.kind === "tool.updated" ||
      activity.kind === "tool.completed"
    ) {
      toolChars += safeJsonLength(activity.payload);
    }
  }

  const tokens: Record<SessionContextBreakdownKey, number> = {
    system: charsToTokens(systemChars),
    user: charsToTokens(userChars),
    assistant: charsToTokens(assistantChars),
    tool: charsToTokens(toolChars),
    other: 0,
  };

  const estimatedTotal = tokens.system + tokens.user + tokens.assistant + tokens.tool;

  if (inputTokens !== null && inputTokens > 0) {
    if (estimatedTotal <= inputTokens) {
      tokens.other = inputTokens - estimatedTotal;
    } else {
      const scale = inputTokens / estimatedTotal;
      tokens.system = Math.floor(tokens.system * scale);
      tokens.user = Math.floor(tokens.user * scale);
      tokens.assistant = Math.floor(tokens.assistant * scale);
      tokens.tool = Math.floor(tokens.tool * scale);
      const sum = tokens.system + tokens.user + tokens.assistant + tokens.tool;
      tokens.other = Math.max(0, inputTokens - sum);
    }
  }

  const total = ORDERED_KEYS.reduce((sum, key) => sum + tokens[key], 0);
  if (total <= 0) {
    return [];
  }

  const segments: SessionContextBreakdownSegment[] = [];
  for (const key of ORDERED_KEYS) {
    const count = tokens[key];
    if (count <= 0) continue;
    const ratio = count / total;
    const percent = Math.round(ratio * 1000) / 10;
    segments.push({
      key,
      tokens: count,
      width: ratio * 100,
      percent,
    });
  }
  return segments;
}
