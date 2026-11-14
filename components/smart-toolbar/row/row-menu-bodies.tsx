"use client";

import type { Editor } from "@tiptap/react";
import { useId } from "react";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuReason,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useActionView } from "@/hooks/use-editor-context";
import { useToolbarDensity } from "@/hooks/use-toolbar-density";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { MoonStarIcon, SunIcon } from "@/lib/icons";
import { applyTheme, THEME_CHANGE_EVENT, THEME_STORAGE_KEY } from "@/lib/theme";

import { lazySurface } from "../lazy-surface";
import { ActionMenuItem, ActionRadioItem } from "./menu-items";

/*
 * The row menus' items (menu chunk, `menu-bodies.ts`); their triggers are
 * `style-menu.tsx`, `align-menu.tsx` and `overflow-menu.tsx`.
 */

const STYLE_IDS = [
  ["style.paragraph", "paragraph"],
  ["style.heading1", "heading-1"],
  ["style.heading2", "heading-2"],
  ["style.heading3", "heading-3"],
  ["style.heading4", "heading-4"],
  ["style.heading5", "heading-5"],
  ["style.heading6", "heading-6"],
] as const;

/** Your formats (design pass §4): a lazy chunk, fetched on first open. */
const StyleFormats = lazySurface(() =>
  import("../formats/style-formats").then((module) => module.StyleFormats),
);

/** Text style ▾: the `style.*` actions, then Your formats. */
export function StyleMenuItems({
  editor,
  value,
  onPicked,
  removing,
}: {
  editor: Editor;
  /** The radio value of the current style ("heading-2"), or "". */
  value: string;
  onPicked: () => void;
  /** Opened at "Remove a format ▸" (the `formats.remove` intent). */
  removing: boolean;
}) {
  return (
    <>
      <DropdownMenuRadioGroup value={value}>
        {STYLE_IDS.map(([id, style]) => (
          <ActionRadioItem
            key={id}
            id={id}
            value={style}
            editor={editor}
            onPicked={onPicked}
          />
        ))}
      </DropdownMenuRadioGroup>
      <StyleFormats editor={editor} onPicked={onPicked} removing={removing} />
    </>
  );
}

const ALIGNS = ["left", "center", "right", "justify"] as const;

/** Align ▾ (and the T3 ¶ menu's first group): the `align.*` actions. */
export function AlignMenuItems({
  editor,
  value,
  onPicked,
  inset = false,
}: {
  editor: Editor;
  value: string;
  onPicked: () => void;
  /** In the T3 ¶ menu: lines the text up with Outdent's and Indent's. */
  inset?: boolean;
}) {
  return (
    <DropdownMenuRadioGroup value={value}>
      {ALIGNS.map((align) => (
        <ActionRadioItem
          key={align}
          id={`align.${align}`}
          value={align}
          editor={editor}
          onPicked={onPicked}
          inset={inset}
        />
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** Toggles shown as checkbox items, then plain commands (spec §4.1 ⋯). */
const TOGGLES = ["mark.superscript", "mark.subscript", "mark.inlineCode"];
/**
 * Later tracks' ids are listed here and skipped until they land
 * (contract §3.2): Paint format and All actions… (E), Forget my choices
 * (D2).
 */
const COMMANDS = [
  "format.clear",
  "repeat.copy",
  "memory.forget",
  "palette.open",
];

function ThemeMenuItem() {
  const dark = document.documentElement.classList.contains("dark");
  const Icon = dark ? SunIcon : MoonStarIcon;
  return (
    <DropdownMenuItem
      // The toggles' check column, as on the commands above.
      className="pr-8"
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

const SIMPLE_TOOLBAR = "view.simpleToolbar";

/**
 * Simplified toolbar (A15). Checked from the remembered density, which an
 * action's `isActive` may not read (contract §3.1). No icon (the only
 * fitting one is Fold section's), so it is inset like `ActionMenuItem`'s
 * icon-less items. Like Theme, it leaves focus on ⋯ (no `onPicked`), and
 * closes first so the row never collapses under an open menu.
 */
function DensityMenuItem({ editor }: { editor: Editor }) {
  const density = useToolbarDensity();
  const view = useActionView(SIMPLE_TOOLBAR, editor);
  const reasonId = useId();
  const action = editorActions.get(SIMPLE_TOOLBAR);
  if (!action || !view) return null;
  const reason = view.enabled === true ? undefined : view.enabled.reason;
  return (
    <DropdownMenuCheckboxItem
      inset
      checked={density === "simple"}
      closeOnClick
      disabled={reason !== undefined}
      aria-describedby={reason ? reasonId : undefined}
      data-action-id={SIMPLE_TOOLBAR}
      onClick={() => runAction(editor, action)}
    >
      <span>{action.label}</span>
      {reason ? (
        <DropdownMenuReason id={reasonId}>{reason}</DropdownMenuReason>
      ) : null}
    </DropdownMenuCheckboxItem>
  );
}

/**
 * ⋯ More formatting: superscript, subscript, inline code, clear
 * formatting, then D2's and E's entries once registered, then the view
 * settings: Simplified toolbar, and Theme when the row has moved it here
 * (T2 or the simplified toolbar).
 */
export function OverflowMenuItems({
  editor,
  onPicked,
  themeInMenu,
}: {
  editor: Editor;
  onPicked: () => void;
  themeInMenu: boolean;
}) {
  const commands = COMMANDS.filter((id) => editorActions.has(id));
  return (
    <>
      {TOGGLES.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          checkbox
          onPicked={onPicked}
        />
      ))}
      <DropdownMenuSeparator />
      {commands.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          checkColumn
          onPicked={onPicked}
        />
      ))}
      <DropdownMenuSeparator />
      <DensityMenuItem editor={editor} />
      {themeInMenu ? <ThemeMenuItem /> : null}
    </>
  );
}
