import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { fetchEnvironmentThreadSnapshot } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, OrchestrationMessage, ThreadId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { runtime } from "./lib/runtime";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { environmentSession, readPreparedConnection } from "./state/session";

const PREVIEW_LENGTH = 140;

export function completionMessagePreview(
  messages: ReadonlyArray<OrchestrationMessage>,
  turnId: TurnId | null,
): string {
  const message = messages.findLast(
    (message) =>
      message.role === "assistant" &&
      message.turnId === turnId &&
      !message.streaming &&
      message.text.trim().length > 0,
  );
  const text = message?.text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|\n)\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/g, "$1")
    .replace(/[*`_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Thread completed";
  if (text.length <= PREVIEW_LENGTH) return text;
  const window = text.slice(0, PREVIEW_LENGTH);
  const sentenceEnd = Math.max(...[...window.matchAll(/[.!?](?=\s)/g)].map((match) => match.index));
  if (sentenceEnd >= PREVIEW_LENGTH / 3) return window.slice(0, sentenceEnd + 1);
  const wordEnd = window.lastIndexOf(" ");
  return `${(wordEnd > 0 ? window.slice(0, wordEnd) : window.slice(0, -1)).trimEnd()}…`;
}

export async function loadCompletionMessagePreview(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  turnId: TurnId | null,
): Promise<string> {
  try {
    const prepared = readPreparedConnection(environmentId);
    if (!prepared) return "Thread completed";
    const config = appAtomRegistry.get(environmentSession.initialConfigValueAtom(environmentId));
    const snapshot = await runtime.runPromise(
      Effect.gen(function* () {
        const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
        return yield* fetchEnvironmentThreadSnapshot({
          prepared,
          threadId,
          signer,
          timeoutMs: 3_000,
          ...(config?.threadSnapshotPagination ? { window: { turnLimit: 1 } } : {}),
        });
      }),
    );
    return completionMessagePreview(snapshot.thread.messages, turnId);
  } catch {
    return "Thread completed";
  }
}
