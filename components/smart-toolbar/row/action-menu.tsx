"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import { type ReactNode, useCallback, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu-trigger";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import { ChevronDownIcon } from "@/lib/icons";

import { menuBody, prefetchMenuBodies, useMenuGate } from "../lazy-menu";

const Content = menuBody((bodies) => bodies.ToolbarMenuContent);

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
  /** A body from the menu chunk (`menuBody`): the editor chunk keeps none. */
  children: ReactNode;
  contentLabel?: string;
  /** Extra trigger classes, such as letting a long value shrink and truncate. */
  triggerClassName?: string;
  /**
   * A short value ("H2") that replaces the label at the narrowest ladder
   * tier (T5, `smart-toolbar.scss`). The name then comes from the visible
   * text: "Heading 2" above T5, "H2 Heading 2" at T5 (WCAG 2.5.3).
   */
  short?: string;
}

/**
 * A toolbar menu button (spec §6.4): named by its visible value,
 * `aria-haspopup="menu"`, never `aria-pressed`. Its popup and items load
 * with the menu chunk (`lazy-menu.tsx`), which the first open waits for.
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
  short,
}: MenuTriggerProps) {
  const openMenu = useMenuGate(onOpenChange);
  const handleOpenChange: typeof openMenu = (next, details) => {
    if (next && readOnly) return;
    openMenu(next, details);
  };
  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        disabled={readOnly}
        render={
          <ToolbarButton
            type="button"
            aria-haspopup="menu"
            aria-label={short ? undefined : label}
            tooltip={tooltip}
            size="sm"
            className={triggerClassName}
            disabled={readOnly}
            disabledReason={readOnly ? READ_ONLY_REASON : undefined}
            onPointerEnter={prefetchMenuBodies}
            onFocus={prefetchMenuBodies}
          />
        }
      >
        {icon}
        {short ? (
          <span className="st-short">
            {short}
            {short !== label && <span className="sr-only">{label}</span>}
          </span>
        ) : null}
        {showLabel ? <span className="min-w-0 truncate">{label}</span> : null}
        <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <Content finalFocus={finalFocus} label={contentLabel}>
        {children}
      </Content>
    </DropdownMenu>
  );
}
