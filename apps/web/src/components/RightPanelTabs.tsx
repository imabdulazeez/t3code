import type { PreviewSessionSnapshot, ProjectScriptScope } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import { BarChart3, ClipboardList, FileDiff, Globe2, Plus, TerminalSquare, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { isElectron } from "~/env";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { faviconUrlForOrigin } from "~/lib/favicon";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";

interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onAddBrowser: () => void;
  onAddTerminal: (scope: ProjectScriptScope) => void;
  onAddDiff: () => void;
  onAddContext: () => void;
  browserAvailable: boolean;
  diffAvailable: boolean;
  projectTerminalAvailable: boolean;
  children: ReactNode;
}

const TERMINAL_SCOPE_COPY: Record<ProjectScriptScope, string> = {
  chat: "Start a shell scoped to this chat.",
  project: "Start a shell for this project.",
};

function TerminalScopeToggle({
  scope,
  onScopeChange,
}: {
  scope: ProjectScriptScope;
  onScopeChange: (scope: ProjectScriptScope) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/80 p-0.5">
      {(["chat", "project"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onScopeChange(value);
          }}
          className={cn(
            "rounded px-2 py-0.5 text-xs font-medium capitalize transition",
            scope === value
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

function TerminalSurfaceCard({
  projectTerminalAvailable,
  onAddTerminal,
}: {
  projectTerminalAvailable: boolean;
  onAddTerminal: (scope: ProjectScriptScope) => void;
}) {
  const [scope, setScope] = useState<ProjectScriptScope>("chat");
  return (
    <button
      type="button"
      onClick={() => onAddTerminal(scope)}
      className="flex min-h-28 flex-col items-start rounded-lg border border-border/80 bg-card/40 p-4 text-left transition hover:border-border hover:bg-accent/60"
    >
      <div className="mb-3 flex w-full items-center justify-between gap-2">
        <TerminalSquare className="size-5" />
        {projectTerminalAvailable ? (
          <TerminalScopeToggle scope={scope} onScopeChange={setScope} />
        ) : null}
      </div>
      <span className="text-sm font-medium">Terminal</span>
      <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {TERMINAL_SCOPE_COPY[scope]}
      </span>
    </button>
  );
}

function RightPanelEmptyState(props: {
  onAddBrowser: () => void;
  onAddTerminal: (scope: ProjectScriptScope) => void;
  onAddDiff: () => void;
  onAddContext: () => void;
  browserAvailable: boolean;
  diffAvailable: boolean;
  projectTerminalAvailable: boolean;
}) {
  const actions = [
    {
      label: "Browser",
      description: "Open a local app or URL.",
      icon: Globe2,
      available: props.browserAvailable,
      onClick: props.onAddBrowser,
    },
    {
      label: "Diff",
      description: "Review changes in this thread.",
      icon: FileDiff,
      available: props.diffAvailable,
      onClick: props.onAddDiff,
    },
    {
      label: "Context",
      description: "Inspect token usage and message breakdown.",
      icon: BarChart3,
      available: true,
      onClick: props.onAddContext,
    },
  ] as const;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="mb-5 text-center">
          <h3 className="text-sm font-medium text-foreground">Open a surface</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose what to show in the right panel.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {actions.slice(0, 1).map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                disabled={!action.available}
                onClick={action.onClick}
                className="flex min-h-28 flex-col items-start rounded-lg border border-border/80 bg-card/40 p-4 text-left transition hover:border-border hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon className="mb-3 size-5" />
                <span className="text-sm font-medium">{action.label}</span>
                <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </span>
              </button>
            );
          })}
          <TerminalSurfaceCard
            projectTerminalAvailable={props.projectTerminalAvailable}
            onAddTerminal={props.onAddTerminal}
          />
          {actions.slice(1).map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                disabled={!action.available}
                onClick={action.onClick}
                className="flex min-h-28 flex-col items-start rounded-lg border border-border/80 bg-card/40 p-4 text-left transition hover:border-border hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon className="mb-3 size-5" />
                <span className="text-sm font-medium">{action.label}</span>
                <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "context":
      return "Context";
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "plan":
      return "Plan";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function PreviewFavicon({ url }: { url: string | null }) {
  const faviconUrl = faviconUrlForOrigin(url, 32);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!faviconUrl || failedUrl === faviconUrl) return <Globe2 className="size-3.5 shrink-0" />;
  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden
      draggable={false}
      className="size-3.5 shrink-0 rounded-sm"
      onError={() => setFailedUrl(faviconUrl)}
    />
  );
}

function SurfaceIcon({
  surface,
  sessions,
}: {
  surface: RightPanelSurface;
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
}) {
  switch (surface.kind) {
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
      return <PreviewFavicon url={url} />;
    }
    case "diff":
      return <FileDiff className="size-3.5 shrink-0" />;
    case "context":
      return <BarChart3 className="size-3.5 shrink-0" />;
    case "terminal":
      return <TerminalSquare className="size-3.5 shrink-0" />;
    case "plan":
      return <ClipboardList className="size-3.5 shrink-0" />;
  }
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";

  return (
    <PreviewPanelShell mode={props.mode}>
      <div
        className={cn(
          "flex shrink-0 items-center px-2",
          ownsDesktopTitleBar
            ? "drag-region h-[52px] wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]"
            : "h-10",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {props.surfaces.map((surface) => {
            const active = surface.id === props.activeSurfaceId;
            const title = surfaceTitle(surface, props.previewSessions, props.terminalLabelsById);
            return (
              <div
                key={surface.id}
                className={cn(
                  "group flex h-7 min-w-0 max-w-52 items-center gap-1.5 rounded-md px-2 text-sm",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5"
                        onClick={() => props.onActivate(surface)}
                      >
                        <SurfaceIcon surface={surface} sessions={props.previewSessions} />
                        <span className="truncate">{title}</span>
                      </button>
                    }
                  />
                  <TooltipPopup>{title}</TooltipPopup>
                </Tooltip>
                <button
                  type="button"
                  className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Close ${title}`}
                  onClick={() => props.onCloseSurface(surface)}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <Menu>
          <MenuTrigger
            className="relative ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Add panel surface"
          >
            <Plus className="size-4" />
          </MenuTrigger>
          <MenuPopup align="start" side="bottom" sideOffset={6} className="min-w-44">
            <MenuItem onClick={props.onAddBrowser} disabled={!props.browserAvailable}>
              <Globe2 />
              Browser
            </MenuItem>
            {props.projectTerminalAvailable ? (
              <>
                <MenuItem onClick={() => props.onAddTerminal("chat")}>
                  <TerminalSquare />
                  Chat terminal
                </MenuItem>
                <MenuItem onClick={() => props.onAddTerminal("project")}>
                  <TerminalSquare />
                  Project terminal
                </MenuItem>
              </>
            ) : (
              <MenuItem onClick={() => props.onAddTerminal("chat")}>
                <TerminalSquare />
                Terminal
              </MenuItem>
            )}
            <MenuItem onClick={props.onAddDiff} disabled={!props.diffAvailable}>
              <FileDiff />
              Diff
            </MenuItem>
            <MenuItem onClick={props.onAddContext}>
              <BarChart3 />
              Context
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {props.activeSurfaceId === null ? (
          <RightPanelEmptyState
            onAddBrowser={props.onAddBrowser}
            onAddTerminal={props.onAddTerminal}
            onAddDiff={props.onAddDiff}
            onAddContext={props.onAddContext}
            browserAvailable={props.browserAvailable}
            diffAvailable={props.diffAvailable}
            projectTerminalAvailable={props.projectTerminalAvailable}
          />
        ) : (
          props.children
        )}
      </div>
    </PreviewPanelShell>
  );
}
