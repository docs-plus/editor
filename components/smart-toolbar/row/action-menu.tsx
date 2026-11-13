"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useRef,
  useState,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import { ChevronDownIcon } from "@/lib/icons";

import { useIdlePreload } from "../idle-preload";

/** The editor from props, else from `EditorContext`. */
export function useSurfaceEditor(provided?: Editor | null): Editor | null {
  const { editor } = useCurrentEditor();
  return provided ?? editor ?? null;
}

/**
 * Focus after a menu closes: after a pick the editor already holds the
 * selection, so focus goes there at once (a keystroke typed before Base UI's
 * exit animation would otherwise go to the menu); Esc and outside clicks
 * fall back to the trigger.
 */
export function useMenuFocus(editor: Editor | null) {
  const [open, setOpen] = useState(false);
  const picked = useRef(false);
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next && picked.current) editor?.view.focus();
    },
    [editor],
  );
  const finalFocus = useCallback(() => {
    if (!picked.current) return true;
    picked.current = false;
    return editor?.view.dom ?? true;
  }, [editor]);
  const markPicked = useCallback(() => {
    picked.current = true;
  }, []);
  return { open, onOpenChange, finalFocus, markPicked };
}

interface MenuTriggerProps {
  label: string;
  tooltip: string;
  /** Only the read-only reason disables a menu trigger; items carry theirs. */
  readOnly: boolean;
  icon?: ReactNode;
  showLabel?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | boolean;
  children: ReactNode;
  contentLabel?: string;
  /** Extra trigger classes, such as letting a long value shrink and truncate. */
  triggerClassName?: string;
}

/**
 * A toolbar menu button (spec §6.4): named by its visible value,
 * `aria-haspopup="menu"`, never `aria-pressed`. Its popup is marked
 * `data-toolbar-popup`, so focus inside it keeps the slot held.
 */
export function ToolbarMenu({
  label,
  tooltip,
  readOnly,
  icon,
  showLabel = true,
  open,
  onOpenChange,
  finalFocus,
  children,
  contentLabel,
  triggerClassName,
}: MenuTriggerProps) {
  useIdlePreload(loadMenuItems);
  const handleOpenChange = (next: boolean) => {
    if (next && readOnly) return;
    onOpenChange(next);
  };
  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        disabled={readOnly}
        render={
          <ToolbarButton
            type="button"
            aria-haspopup="menu"
            aria-label={label}
            tooltip={tooltip}
            size="sm"
            className={triggerClassName}
            disabled={readOnly}
            disabledReason={readOnly ? READ_ONLY_REASON : undefined}
            onPointerEnter={loadMenuItems}
            onFocus={loadMenuItems}
          />
        }
      >
        {icon}
        {showLabel ? <span className="min-w-0 truncate">{label}</span> : null}
        <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        finalFocus={finalFocus}
        data-toolbar-popup=""
        aria-label={contentLabel}
        className="min-w-52"
      >
        <Suspense fallback={null}>{children}</Suspense>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Menu items: their own chunk, fetched when the page is idle. */
export const loadMenuItems = () => import("./menu-items");
/** One registry action as a menu item, with its reason and shortcut. */
export const ActionMenuItem = lazy(() =>
  loadMenuItems().then((module) => ({ default: module.ActionMenuItem })),
);
/** One registry action as a radio item of a value menu. */
export const ActionRadioItem = lazy(() =>
  loadMenuItems().then((module) => ({ default: module.ActionRadioItem })),
);

export { DropdownMenuRadioGroup };
