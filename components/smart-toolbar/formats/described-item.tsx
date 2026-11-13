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
 * A menu item whose accessible name is its visible label (WCAG 2.5.3),
 * named by `aria-labelledby` so a visible reason is never part of it, and
 * whose description, named by `aria-describedby`, is either why it is
 * unavailable, shown as a visible second line (`DropdownMenuReason`,
 * design pass §10), or its long form ("Bold, Red text"), which stays
 * hidden: the item already shows it in its own formatting. The label is
 * an element, so a disabled item dims it (the reason stays at full
 * strength).
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
  const labelId = useId();
  return (
    <DropdownMenuItem
      disabled={disabled}
      className={className}
      aria-labelledby={labelId}
      aria-describedby={description ? id : undefined}
      data-saved-format={savedFormat}
      onClick={onClick}
    >
      <span id={labelId}>{label}</span>
      {children}
      <Description id={id} text={description} visible={disabled} />
    </DropdownMenuItem>
  );
}
