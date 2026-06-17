import {
  ChevronDownIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelBottomIcon,
  PanelRightIcon,
} from "lucide-react";
import { memo } from "react";

import { type ProjectScriptScope } from "@t3tools/contracts";

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
  onToggleTerminal: () => void;
  onToggleRightPanel: () => void;
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
  onToggleTerminal,
  onToggleRightPanel,
}: PanelLayoutControlsProps) {
  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
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

export const RightPanelMaximizeControl = memo(function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const label = maximized ? "Restore panel size" : "Maximize panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={maximized}
            onPressedChange={onToggle}
            aria-label={label}
            variant="ghost"
            size="sm"
          >
            {maximized ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <Maximize2Icon className="size-3.5" />
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
});
