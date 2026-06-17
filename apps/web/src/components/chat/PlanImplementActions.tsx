import { memo, type PointerEventHandler } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

interface PlanImplementActionsProps {
  isReimplementation: boolean;
  isBusy: boolean;
  disabled: boolean;
  canRevertPlan?: boolean;
  menuSide?: "top" | "bottom";
  menuPositionerClassName?: string;
  preserveFocusOnPointerDown?: boolean;
  primaryClassName?: string;
  menuTriggerClassName?: string;
  onImplement?: () => void;
  onImplementInNewThread: () => void;
  onImplementInNewThreadDraft: () => void;
  onRevertPlan?: () => void;
}

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

export const PlanImplementActions = memo(function PlanImplementActions({
  isReimplementation,
  isBusy,
  disabled,
  canRevertPlan = false,
  menuSide = "top",
  menuPositionerClassName,
  preserveFocusOnPointerDown = false,
  primaryClassName,
  menuTriggerClassName,
  onImplement,
  onImplementInNewThread,
  onImplementInNewThreadDraft,
  onRevertPlan,
}: PlanImplementActionsProps) {
  const pointerFocusProps = preserveFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;

  const primaryLabel = isBusy
    ? isReimplementation
      ? "Reimplementing..."
      : "Sending..."
    : isReimplementation
      ? "Reimplement"
      : "Implement";

  return (
    <div className="flex items-center justify-end">
      <Button
        type={onImplement ? "button" : "submit"}
        size="sm"
        className={cn("h-9 rounded-l-full rounded-r-none px-4 sm:h-8", primaryClassName)}
        {...pointerFocusProps}
        disabled={disabled}
        {...(onImplement ? { onClick: onImplement } : {})}
      >
        {primaryLabel}
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="sm"
              variant="default"
              className={cn(
                "h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8",
                menuTriggerClassName,
              )}
              aria-label="Implementation actions"
              {...pointerFocusProps}
              disabled={disabled}
            />
          }
        >
          <ChevronDownIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup
          align="end"
          side={menuSide}
          {...(menuPositionerClassName ? { positionerClassName: menuPositionerClassName } : {})}
        >
          <MenuItem disabled={disabled} onClick={() => void onImplementInNewThread()}>
            {isReimplementation ? "Reimplement in a new thread" : "Implement in a new thread"}
          </MenuItem>
          <MenuItem disabled={disabled} onClick={() => void onImplementInNewThreadDraft()}>
            {isReimplementation
              ? "Reimplement in a new thread (don't send)"
              : "Implement in a new thread (don't send)"}
          </MenuItem>
          {canRevertPlan && onRevertPlan ? (
            <MenuItem disabled={disabled} onClick={() => void onRevertPlan()}>
              Revert plan to message
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
    </div>
  );
});
