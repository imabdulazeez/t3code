import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Minimize2Icon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import ChatMarkdown from "../ChatMarkdown";

interface FullScreenPlanPayload {
  planMarkdown: string;
  title: string;
  label: string;
  cwd: string | undefined;
}

interface FullScreenPlanContextValue {
  openFullScreenPlan: (payload: FullScreenPlanPayload) => void;
  closeFullScreenPlan: () => void;
}

const FullScreenPlanContext = createContext<FullScreenPlanContextValue | null>(null);

export function useFullScreenPlan(): FullScreenPlanContextValue {
  const value = useContext(FullScreenPlanContext);
  if (!value) {
    throw new Error("useFullScreenPlan must be used within a FullScreenPlanProvider");
  }
  return value;
}

export function FullScreenPlanProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<FullScreenPlanPayload | null>(null);

  const openFullScreenPlan = useCallback((next: FullScreenPlanPayload) => {
    setPayload(next);
  }, []);

  const closeFullScreenPlan = useCallback(() => {
    setPayload(null);
  }, []);

  const value = useMemo(
    () => ({ openFullScreenPlan, closeFullScreenPlan }),
    [openFullScreenPlan, closeFullScreenPlan],
  );

  useEffect(() => {
    if (!payload) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPayload(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [payload]);

  return (
    <FullScreenPlanContext.Provider value={value}>
      {children}
      {payload ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-3 backdrop-blur-md sm:p-6"
          onClick={closeFullScreenPlan}
        >
          <div
            className="flex h-full max-h-full w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-2">
                <Badge
                  variant="secondary"
                  className="rounded-md bg-blue-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-blue-400 uppercase"
                >
                  {payload.label}
                </Badge>
                <p className="truncate text-sm font-medium text-foreground">{payload.title}</p>
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={closeFullScreenPlan}
                aria-label="Exit full screen plan"
                className="text-muted-foreground/50 hover:text-foreground/70"
              >
                <Minimize2Icon className="size-3.5" />
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
                <ChatMarkdown text={payload.planMarkdown} cwd={payload.cwd} isStreaming={false} />
              </div>
            </ScrollArea>
          </div>
        </div>
      ) : null}
    </FullScreenPlanContext.Provider>
  );
}
