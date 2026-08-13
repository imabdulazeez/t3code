import type { DesktopLocalUpdateState } from "@t3tools/contracts";
import { DownloadIcon, LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarLocalUpdatePill() {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const [state, setState] = useState<DesktopLocalUpdateState | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onLocalUpdateState((nextState) => {
      if (active) setState(nextState);
    });
    void bridge.getLocalUpdateState().then((nextState) => {
      if (active) setState(nextState);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  if (!bridge || !state?.availableBuild) return null;

  const installing = state.status === "installing";
  const description = installing
    ? "Installing the local desktop update"
    : `Install ${state.availableBuild.fileName}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={description}
            disabled={installing}
            className="flex h-7 w-full items-center gap-2 rounded-lg bg-update-surface px-2 text-left text-xs font-medium text-update-foreground hover:bg-update/22 disabled:opacity-70"
            onClick={() => {
              void bridge.installLocalUpdate().then(setState);
            }}
          >
            {installing ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <DownloadIcon className="size-3.5" />
            )}
            <span>{installing ? "Installing desktop update" : "Desktop update available"}</span>
          </button>
        }
      />
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
}
