import { CircleArrowUpIcon, RefreshCwIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useDesktopLocalUpdateState } from "../../state/desktopLocalUpdate";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { UpdateEverythingDialog } from "./UpdateEverythingDialog";
import { useUpdateEverything } from "./useUpdateEverything";

export function SidebarLocalUpdatePill() {
  return <SidebarLocalUpdateControl />;
}

function SidebarLocalUpdateControl() {
  const state = useDesktopLocalUpdateState();
  const [actionPending, setActionPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const updateAvailable = state?.status === "available" && state.availableBuild !== null;
  const localVersion = updateAvailable ? state.availableBuild.version : null;
  const everything = useUpdateEverything(localVersion);
  const installing = state?.status === "installing";
  const checking = state?.status === "checking";
  const upToDate = state?.status === "idle" && state.checkedAt !== null;
  const updateStateVisible = updateAvailable || installing || everything.hasUpdates;
  const tooltip = actionPending
    ? "Updating…"
    : everything.hasUpdates
      ? everything.summary
      : !state?.supported
        ? (state?.message ?? "Local desktop updates are unavailable in this build.")
        : state.folderPath === null
          ? "Choose a local releases folder in Settings → General → About"
          : installing
            ? "Installing the local desktop update"
            : updateAvailable
              ? `Install ${state.availableBuild?.fileName}`
              : checking
                ? "Checking for updates…"
                : upToDate
                  ? "You're up to date"
                  : "Check for updates";
  const disabled =
    actionPending ||
    installing ||
    checking ||
    (!everything.hasUpdates && (!state?.supported || state.folderPath === null));

  const runEverything = useCallback(async () => {
    setConfirming(false);
    setActionPending(true);
    try {
      const bridge = window.desktopBridge;
      await everything.run(
        bridge && updateAvailable
          ? {
              installLocal: async () => {
                const nextState = await bridge.installLocalUpdate();
                if (nextState.status === "error") {
                  throw new Error(nextState.message ?? "The local update could not be installed.");
                }
              },
            }
          : {},
      );
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not update everything",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    } finally {
      setActionPending(false);
    }
  }, [everything, updateAvailable]);

  const handleAction = useCallback(async () => {
    if (disabled) return;
    if (updateAvailable || everything.hasUpdates) {
      setConfirming(true);
      return;
    }
    const bridge = window.desktopBridge;
    if (!bridge || !state) return;
    setActionPending(true);
    try {
      const nextState = await bridge.checkForLocalUpdate();
      if (nextState.status === "error") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not check for updates",
            description: nextState.message ?? "The local releases folder could not be checked.",
          }),
        );
      }
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: updateAvailable ? "Could not install update" : "Could not check for updates",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    } finally {
      setActionPending(false);
    }
  }, [disabled, everything.hasUpdates, state, updateAvailable]);

  if (!isElectron && !everything.hasUpdates && !actionPending) return null;

  return (
    <SidebarMenuItem className="ml-auto shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={tooltip}
              aria-disabled={disabled || undefined}
              disabled={disabled}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full outline-hidden ring-ring transition-colors enabled:cursor-pointer focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60",
                updateStateVisible
                  ? "bg-update-surface text-update-foreground enabled:hover:bg-update/12"
                  : "text-(--sidebar-icon-color) enabled:hover:bg-sidebar-row-hover enabled:hover:text-sidebar-foreground",
              )}
              onClick={() => void handleAction()}
            >
              {installing ? (
                <RotateCwIcon className="size-4 animate-spin" />
              ) : everything.hasUpdates ? (
                <CircleArrowUpIcon className="size-4" />
              ) : updateAvailable ? (
                <RotateCwIcon className="size-4" />
              ) : (
                <RefreshCwIcon className={cn("size-4", checking && "animate-spin")} />
              )}
            </button>
          }
        />
        <TooltipPopup
          align="center"
          side="top"
          style={
            updateStateVisible
              ? {
                  background:
                    "color-mix(in srgb, var(--update) 18%, color-mix(in srgb, var(--popover) var(--glass-opacity), transparent))",
                  borderColor: "var(--update-foreground)",
                }
              : undefined
          }
          variant={updateStateVisible ? "glass" : "default"}
        >
          {tooltip}
        </TooltipPopup>
      </Tooltip>
      <UpdateEverythingDialog
        open={confirming}
        onOpenChange={setConfirming}
        summary={everything.summary}
        lines={everything.lines.map((line) =>
          updateAvailable && line.startsWith("This app:")
            ? `This app: ${state.availableBuild.fileName}, restarts last`
            : line,
        )}
        restarts={everything.restarts}
        onConfirm={() => void runEverything()}
      />
    </SidebarMenuItem>
  );
}
