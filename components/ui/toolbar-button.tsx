"use client";

import type { VariantProps } from "class-variance-authority";
import { Fragment, forwardRef, useMemo } from "react";
import { Button, type buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseShortcutKeys } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

interface ToolbarButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  tooltip?: React.ReactNode;
  showTooltip?: boolean;
  shortcutKeys?: string;
  isActive?: boolean;
}

function ShortcutDisplay({ shortcuts }: { shortcuts: string[] }) {
  if (shortcuts.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      {shortcuts.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && (
            <kbd className="text-muted-foreground text-[10px]">+</kbd>
          )}
          <kbd className="rounded bg-foreground/20 px-1 py-0.5 text-[10px] font-mono">
            {key}
          </kbd>
        </Fragment>
      ))}
    </div>
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
      ...props
    },
    ref,
  ) => {
    const shortcuts = useMemo<string[]>(
      () => parseShortcutKeys({ shortcutKeys }),
      [shortcutKeys],
    );

    const buttonClasses = cn(
      isActive && "bg-foreground/10 text-foreground",
      className,
    );

    if (!tooltip || !showTooltip) {
      return (
        <Button
          ref={ref}
          variant={variant}
          size={size}
          className={buttonClasses}
          {...props}
        >
          {children}
        </Button>
      );
    }

    return (
      <Tooltip>
        <TooltipTrigger
          ref={ref}
          render={
            <Button
              variant={variant}
              size={size}
              className={buttonClasses}
              {...props}
            />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent>
          {tooltip}
          <ShortcutDisplay shortcuts={shortcuts} />
        </TooltipContent>
      </Tooltip>
    );
  },
);

ToolbarButton.displayName = "ToolbarButton";

export { ToolbarButton, ShortcutDisplay };
export type { ToolbarButtonProps };
