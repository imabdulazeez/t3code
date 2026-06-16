import {
  ChevronDownIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelBottomIcon,
  PanelRightIcon,
} from "lucide-react";
import { memo } from "react";

import { type ProjectScriptScope } from "@t3tools/contracts";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PanelLayoutControlsProps {
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalShortcutLabel: string | null;
  terminalScope?: ProjectScriptScope;
  onSetTerminalScope?: (scope: ProjectScriptScope) => void;
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  rightPanelShortcutLabel: string | null;
  rightPanelMaximized: boolean;
  canMaximizeRightPanel: boolean;
  onToggleTerminal: () => void;
  onToggleRightPanel: () => void;
  onToggleRightPanelMaximized: () => void;
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  terminalScope,
  onSetTerminalScope,
  rightPanelAvailable,
  rightPanelOpen,
  rightPanelShortcutLabel,
  rightPanelMaximized,
  canMaximizeRightPanel,
  onToggleTerminal,
  onToggleRightPanel,
  onToggleRightPanelMaximized,
}: PanelLayoutControlsProps) {
  return (
    <div
      className={cn("workspace-titlebar-controls z-50 gap-2 [-webkit-app-region:no-drag]")}
      data-panel-layout-controls
    >
      {rightPanelOpen ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0 [-webkit-app-region:no-drag]"
                pressed={rightPanelMaximized}
                onPressedChange={onToggleRightPanelMaximized}
                aria-label={rightPanelMaximized ? "Restore panel size" : "Maximize panel"}
                variant="ghost"
                size="sm"
                disabled={!canMaximizeRightPanel}
              >
                {rightPanelMaximized ? (
                  <Minimize2Icon className="size-3.5" />
                ) : (
                  <Maximize2Icon className="size-3.5" />
                )}
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {canMaximizeRightPanel
              ? rightPanelMaximized
                ? "Restore panel size"
                : "Maximize panel"
              : "Panel maximization is unavailable at this width"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      <Group aria-label="Terminal controls" className="shrink-0 [-webkit-app-region:no-drag]">
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0 [-webkit-app-region:no-drag]"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="outline"
                size="sm"
                disabled={!terminalAvailable}
              >
                <PanelBottomIcon className="size-3.5" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {terminalAvailable
              ? `Toggle ${terminalScope === "project" ? "project" : "chat"} terminal${
                  terminalShortcutLabel ? ` (${terminalShortcutLabel})` : ""
                }`
              : "Terminal drawer is unavailable"}
          </TooltipPopup>
        </Tooltip>
        {onSetTerminalScope && terminalAvailable ? (
          <>
            <GroupSeparator />
            <Menu highlightItemOnHover={false}>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="Choose default terminal scope"
                    className="shrink-0 [-webkit-app-region:no-drag]"
                  />
                }
              >
                <ChevronDownIcon className="size-3" />
              </MenuTrigger>
              <MenuPopup align="end" side="bottom" className="min-w-40">
                <MenuItem onClick={() => onSetTerminalScope("chat")}>
                  <span className="flex-1">Chat terminal</span>
                  {terminalScope !== "project" ? (
                    <span className="ms-2 text-[10px] uppercase text-muted-foreground">
                      Default
                    </span>
                  ) : null}
                </MenuItem>
                <MenuItem onClick={() => onSetTerminalScope("project")}>
                  <span className="flex-1">Project terminal</span>
                  {terminalScope === "project" ? (
                    <span className="ms-2 text-[10px] uppercase text-muted-foreground">
                      Default
                    </span>
                  ) : null}
                </MenuItem>
              </MenuPopup>
            </Menu>
          </>
        ) : null}
      </Group>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={rightPanelOpen}
              onPressedChange={onToggleRightPanel}
              aria-label="Toggle right panel"
              variant="ghost"
              size="sm"
              disabled={!rightPanelAvailable}
            >
              <PanelRightIcon className="size-3.5" />
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">
          {rightPanelAvailable
            ? `Toggle right panel${rightPanelShortcutLabel ? ` (${rightPanelShortcutLabel})` : ""}`
            : "Right panel is unavailable"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});
