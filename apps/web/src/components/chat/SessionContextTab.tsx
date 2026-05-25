import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { BarChart3, ChevronDown, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { useServerProviders } from "~/rpc/serverState";
import { useStore } from "~/store";
import { createThreadSelectorByRef } from "~/storeSelectors";
import { cn } from "~/lib/utils";
import type { Thread } from "~/types";

import {
  estimateSessionContextBreakdown,
  type SessionContextBreakdownKey,
  type SessionContextBreakdownSegment,
} from "./sessionContextBreakdown";
import { createSessionContextFormatter } from "./sessionContextFormat";
import { getSessionContextMetrics, type SessionContextMetrics } from "./sessionContextMetrics";

const SEGMENT_COLORS: Record<SessionContextBreakdownKey, string> = {
  system: "bg-amber-500",
  user: "bg-sky-500",
  assistant: "bg-emerald-500",
  tool: "bg-violet-500",
  other: "bg-muted-foreground/40",
};

const SEGMENT_LABELS: Record<SessionContextBreakdownKey, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
  other: "Other",
};

const scrollPositionByKey = new Map<string, number>();

interface SessionContextTabProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onClose: () => void;
}

export function SessionContextTab({ environmentId, threadId, onClose }: SessionContextTabProps) {
  const threadRef = useMemo(() => ({ environmentId, threadId }), [environmentId, threadId]);
  const thread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const providers = useServerProviders();

  const formatter = useMemo(() => createSessionContextFormatter(), []);

  const metrics = useMemo<SessionContextMetrics | null>(
    () => (thread ? getSessionContextMetrics(thread, providers) : null),
    [thread, providers],
  );

  const breakdown = useMemo<SessionContextBreakdownSegment[]>(
    () =>
      thread
        ? estimateSessionContextBreakdown({
            messages: thread.messages,
            activities: thread.activities,
            input: metrics?.input ?? null,
          })
        : [],
    [thread, metrics?.input],
  );

  const scrollKey = `${environmentId}:${threadId}`;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rafHandleRef = useRef<number | null>(null);

  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    const saved = scrollPositionByKey.get(scrollKey) ?? 0;
    node.scrollTop = saved;
  }, [scrollKey]);

  useEffect(() => {
    return () => {
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (rafHandleRef.current !== null) return;
    rafHandleRef.current = window.requestAnimationFrame(() => {
      rafHandleRef.current = null;
      const node = scrollContainerRef.current;
      if (!node) return;
      scrollPositionByKey.set(scrollKey, node.scrollTop);
    });
  }, [scrollKey]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <SessionContextTabHeader onClose={onClose} />
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        {!thread || !metrics ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            Thread is not loaded.
          </div>
        ) : (
          <div className="space-y-6 px-4 py-4">
            <StatsGrid metrics={metrics} formatter={formatter} />
            <BreakdownSection segments={breakdown} formatter={formatter} />
            <RawMessagesSection thread={thread} formatter={formatter} />
          </div>
        )}
      </div>
    </div>
  );
}

function SessionContextTabHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2">
        <BarChart3 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-sm font-medium text-foreground">Context Usage</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Close context panel"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function StatsGrid({
  metrics,
  formatter,
}: {
  metrics: SessionContextMetrics;
  formatter: ReturnType<typeof createSessionContextFormatter>;
}) {
  const rawEntries: Array<{ label: string; value: string }> = [
    { label: "Session", value: metrics.sessionTitle },
    { label: "Messages", value: formatter.number(metrics.messageCount) },
    { label: "Provider", value: metrics.providerLabel },
    { label: "Model", value: metrics.modelLabel },
    { label: "Context Limit", value: formatter.number(metrics.limit) },
    { label: "Total Tokens", value: formatter.number(metrics.total) },
    { label: "Total Processed", value: formatter.number(metrics.totalProcessedTokens) },
    { label: "Usage", value: formatter.percent(metrics.usage) },
    { label: "Input", value: formatter.number(metrics.input) },
    { label: "Output", value: formatter.number(metrics.output) },
    { label: "Reasoning", value: formatter.number(metrics.reasoning) },
    { label: "Cache Read", value: formatter.number(metrics.cacheRead) },
    { label: "User Messages", value: formatter.number(metrics.userMessageCount) },
    { label: "Assistant Messages", value: formatter.number(metrics.assistantMessageCount) },
    { label: "Session Created", value: formatter.time(metrics.sessionCreatedAt) },
    { label: "Last Activity", value: formatter.time(metrics.lastActivityAt) },
  ];
  const entries = rawEntries.filter((entry) => {
    const trimmed = entry.value.trim();
    if (trimmed.length === 0 || trimmed === "—") return false;
    if (trimmed === "0" || trimmed === "0%") return false;
    return true;
  });

  return (
    <section aria-label="Session statistics">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {entries.map((entry) => (
          <div
            key={entry.label}
            className="flex flex-col gap-0.5 rounded-md border border-border/60 bg-card/40 px-3 py-2"
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {entry.label}
            </span>
            <span className="truncate text-sm font-medium text-foreground" title={entry.value}>
              {entry.value}
            </span>
          </div>
        ))}
      </div>
      {metrics.compactsAutomatically ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Automatically compacts its context when needed.
        </p>
      ) : null}
    </section>
  );
}

function BreakdownSection({
  segments,
  formatter,
}: {
  segments: SessionContextBreakdownSegment[];
  formatter: ReturnType<typeof createSessionContextFormatter>;
}) {
  return (
    <section aria-label="Context breakdown">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Breakdown
      </h3>
      {segments.length === 0 ? (
        <p className="text-xs text-muted-foreground">Not enough data to compute a breakdown yet.</p>
      ) : (
        <>
          <div
            className="flex h-2 w-full overflow-hidden rounded bg-muted/60"
            role="img"
            aria-label="Token distribution"
          >
            {segments.map((segment) => (
              <div
                key={segment.key}
                className={cn("h-full", SEGMENT_COLORS[segment.key])}
                style={{ width: `${segment.width}%` }}
              />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {segments.map((segment) => (
              <div key={segment.key} className="flex items-center gap-2 text-xs">
                <span
                  className={cn("size-2.5 shrink-0 rounded-sm", SEGMENT_COLORS[segment.key])}
                  aria-hidden
                />
                <span className="text-muted-foreground">{SEGMENT_LABELS[segment.key]}</span>
                <span className="ml-auto font-medium text-foreground">
                  {segment.percent.toLocaleString()}%
                </span>
                <span className="w-16 text-right text-muted-foreground">
                  {formatter.number(segment.tokens)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function RawMessagesSection({
  thread,
  formatter,
}: {
  thread: Thread;
  formatter: ReturnType<typeof createSessionContextFormatter>;
}) {
  return (
    <section aria-label="Raw messages">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Raw messages
      </h3>
      {thread.messages.length === 0 ? (
        <p className="text-xs text-muted-foreground">No messages yet.</p>
      ) : (
        <div className="space-y-1">
          {thread.messages.map((message) => {
            const idSuffix = String(message.id).slice(-8);
            const json = JSON.stringify(
              { ...message, attachments: message.attachments ?? [] },
              null,
              2,
            );
            return (
              <Collapsible
                key={message.id}
                className="rounded-md border border-border/60 bg-card/30"
              >
                <CollapsibleTrigger
                  render={
                    <button
                      type="button"
                      className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs"
                    >
                      <ChevronDown
                        className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180"
                        aria-hidden
                      />
                      <span className="font-medium uppercase tracking-[0.06em] text-muted-foreground">
                        {message.role}
                      </span>
                      <span className="text-muted-foreground/80">·</span>
                      <span className="font-mono text-muted-foreground">{idSuffix}</span>
                      <span className="ml-auto text-muted-foreground/80">
                        {formatter.time(message.createdAt)}
                      </span>
                    </button>
                  }
                />
                <CollapsibleContent>
                  <pre className="overflow-x-auto border-t border-border/40 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                    {json}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}
    </section>
  );
}
