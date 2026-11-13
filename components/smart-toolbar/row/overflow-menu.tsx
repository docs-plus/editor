"use client";

import type { Editor } from "@tiptap/react";
import { useState } from "react";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { editorActions } from "@/lib/editor-actions";
import { MoonStarIcon, MoreHorizontalIcon, SunIcon } from "@/lib/icons";
import { applyTheme, THEME_CHANGE_EVENT, THEME_STORAGE_KEY } from "@/lib/theme";

import {
  ActionMenuItem,
  ToolbarMenu,
  useMenuFocus,
  useSurfaceEditor,
} from "./action-menu";

/** Toggles shown as checkbox items, then plain commands (spec §4.1 ⋯). */
const TOGGLES = ["mark.superscript", "mark.subscript", "mark.inlineCode"];
/**
 * Later tracks' ids are listed here and skipped until they land
 * (contract §3.2): Forget my choices (D2), All actions… (E).
 */
const COMMANDS = ["format.clear", "memory.forget", "palette.open"];

/**
 * ⋯ More formatting: superscript, subscript, inline code, clear
 * formatting, then D2's and E's entries once registered. Never disabled as a
 * whole: each item says why it cannot run.
 */
/**
 * T2 moves Theme into ⋯ (spec §4.6): the row's theme button is hidden by a
 * container query, so the menu checks it when it opens.
 */
function rowThemeHidden(): boolean {
  const button = document.querySelector<HTMLElement>(
    '[data-toolbar-group="theme"] button',
  );
  return button !== null && !button.checkVisibility();
}

function ThemeMenuItem() {
  const dark = document.documentElement.classList.contains("dark");
  const Icon = dark ? SunIcon : MoonStarIcon;
  return (
    <DropdownMenuItem
      onClick={() => {
        applyTheme(!dark);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, dark ? "light" : "dark");
        } catch {
          // Private mode: the choice lasts for this page only.
        }
        window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
      }}
    >
      <Icon aria-hidden="true" />
      <span>{`Switch to ${dark ? "light" : "dark"} mode`}</span>
    </DropdownMenuItem>
  );
}

export function OverflowMenu({ editor: provided }: { editor?: Editor | null }) {
  const editor = useSurfaceEditor(provided);
  const menu = useMenuFocus(editor);
  const [themeInMenu, setThemeInMenu] = useState(false);
  if (!editor) return null;
  const commands = COMMANDS.filter((id) => editorActions.has(id));
  return (
    <ToolbarMenu
      label="More formatting"
      tooltip="More formatting"
      readOnly={false}
      icon={<MoreHorizontalIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={(next) => {
        if (next) setThemeInMenu(rowThemeHidden());
        menu.onOpenChange(next);
      }}
      finalFocus={menu.finalFocus}
      contentLabel="More formatting"
    >
      {TOGGLES.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          checkbox
          onPicked={menu.markPicked}
        />
      ))}
      <DropdownMenuSeparator />
      {commands.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          onPicked={menu.markPicked}
        />
      ))}
      {themeInMenu ? (
        <>
          <DropdownMenuSeparator />
          <ThemeMenuItem />
        </>
      ) : null}
    </ToolbarMenu>
  );
}
