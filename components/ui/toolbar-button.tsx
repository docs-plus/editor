"use client";

import type { VariantProps } from "class-variance-authority";
import { forwardRef, useId } from "react";

import { Button, type buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatKeyCombo } from "@/lib/editor-actions/key-combo";
import { isMac } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

interface ToolbarButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  tooltip?: React.ReactNode;
  showTooltip?: boolean;
  shortcutKeys?: string;
  isActive?: boolean;
  /** Why the control is disabled; announced via aria-describedby and shown in the tooltip. */
  disabledReason?: string;
}

/**
 * One `<kbd>` from the shared formatter (design pass §8): "⌘⌥V" on macOS,
 * "Ctrl+Alt+V" elsewhere, as in the palette and menus. `keys` is
 * `"mod+alt+v"` notation.
 */
function ShortcutDisplay({ keys }: { keys?: string }) {
  if (!keys) return null;
  const combo = keys
    .split("+")
    .map((key) => key.charAt(0).toUpperCase() + key.slice(1))
    .join("-");
  return (
    <kbd className="rounded bg-foreground/20 px-1 py-0.5 text-[10px] font-mono">
      {formatKeyCombo(combo, isMac())}
    </kbd>
  );
}

const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  (
    {
      className,
      children,
      tooltip,
      showTooltip = true,
      shortcutKeys,
      variant = "ghost",
      size = "icon-sm",
      isActive,
      disabled,
      disabledReason,
      ...props
    },
    ref,
  ) => {
    const ariaPressed =
      props["aria-pressed"] ??
      (isActive !== undefined && !props["aria-haspopup"]
        ? isActive
        : undefined);

    const reasonId = useId();
    const reason = disabled && disabledReason ? disabledReason : undefined;

    const buttonProps = {
      ...props,
      disabled,
      focusableWhenDisabled: true,
      "aria-describedby": reason
        ? [props["aria-describedby"], reasonId].filter(Boolean).join(" ")
        : props["aria-describedby"],
      "aria-pressed": ariaPressed,
      "data-active": isActive ? "true" : undefined,
    };

    const buttonClasses = cn(
      "data-active:bg-foreground/10 data-active:text-foreground",
      className,
    );

    const reasonNode = reason ? (
      <span id={reasonId} hidden>
        {reason}
      </span>
    ) : null;

    if (!tooltip || !showTooltip) {
      return (
        <>
          <Button
            ref={ref}
            variant={variant}
            size={size}
            className={buttonClasses}
            {...buttonProps}
          >
            {children}
          </Button>
          {reasonNode}
        </>
      );
    }

    return (
      <>
        <Tooltip>
          <TooltipTrigger
            ref={ref}
            render={
              <Button
                variant={variant}
                size={size}
                className={buttonClasses}
                {...buttonProps}
              />
            }
          >
            {children}
          </TooltipTrigger>
          <TooltipContent>
            {reason ?? tooltip}
            {!reason && <ShortcutDisplay keys={shortcutKeys} />}
          </TooltipContent>
        </Tooltip>
        {reasonNode}
      </>
    );
  },
);

ToolbarButton.displayName = "ToolbarButton";

export type { ToolbarButtonProps };
export { ShortcutDisplay, ToolbarButton };
