"use client";

import { type ReactNode, useId } from "react";

import {
  DropdownMenuItem,
  DropdownMenuReason,
} from "@/components/ui/dropdown-menu";

/** A reason shows as a second line; a long form stays hidden. */
function Description({
  id,
  text,
  visible,
}: {
  id: string;
  text?: string;
  visible?: boolean;
}) {
  if (!text) return null;
  if (visible) return <DropdownMenuReason id={id}>{text}</DropdownMenuReason>;
  return (
    <span id={id} hidden>
      {text}
    </span>
  );
}

/**
 * A menu item whose accessible name is its visible text (WCAG 2.5.3) and
 * whose description, named by `aria-describedby`, is either why it is
 * unavailable, shown as a visible second line (`DropdownMenuReason`,
 * design pass §10), or its long form ("Bold, Red text"), which stays
 * hidden: the item already shows it in its own formatting.
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
      <Description id={id} text={description} visible={disabled} />
    </DropdownMenuItem>
  );
}
