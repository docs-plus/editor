"use client";

import { type ReactNode, useId } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * A menu item whose accessible name is its visible text (WCAG 2.5.3) and
 * whose long form ("Bold, Red text") or unavailable reason is its
 * description: a hidden node named by `aria-describedby`, the menus'
 * shared convention (`components/ui/dropdown-menu.tsx` renders disabled
 * reasons from it).
 */
export function DescribedItem({
  label,
  description,
  disabled,
  className,
  onClick,
  children,
  "data-saved-format": savedFormat,
}: {
  /** Visible text; also the accessible name. */
  label: ReactNode;
  description?: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children?: ReactNode;
  "data-saved-format"?: string;
}) {
  const id = useId();
  return (
    <DropdownMenuItem
      disabled={disabled}
      className={className}
      aria-describedby={description ? id : undefined}
      data-saved-format={savedFormat}
      onClick={onClick}
    >
      {label}
      {children}
      {description ? (
        <span id={id} hidden>
          {description}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}
