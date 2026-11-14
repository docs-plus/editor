"use client";

import type { Editor } from "@tiptap/react";
import { useRef } from "react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import { SlotCollapseButton } from "@/components/smart-toolbar/collapse-menus";
import {
  useSlotTarget,
  useToolbarHold,
} from "@/components/smart-toolbar/context-slot/use-slot-target";
import { InsertMenu } from "@/components/smart-toolbar/insert-menu";
import { menuBody } from "@/components/smart-toolbar/lazy-menu";
import {
  ToolbarMenu,
  useMenuFocus,
} from "@/components/smart-toolbar/row/action-menu";
import { useActionView } from "@/hooks/use-editor-context";
import { ListIcon } from "@/lib/icons";

const NO_LIST = "none";

/** The menu's items are in the menu chunk (`phone-menu-bodies.tsx`). */
const PhoneListMenuItems = menuBody((bodies) => bodies.PhoneListMenuItems);

/** The current list action, or "none": the radio group's value. */
function useListValue(editor: Editor): string {
  const bullet = useActionView("list.bullet", editor);
  const ordered = useActionView("list.ordered", editor);
  const task = useActionView("list.task", editor);
  if (bullet?.active) return "list.bullet";
  if (ordered?.active) return "list.ordered";
  if (task?.active) return "list.task";
  return NO_LIST;
}

/**
 * List ▾ as one cell: a radio menu like the row's (`menuitemradio`, one
 * checked), "No list" then the registry's list actions.
 */
function ListCell({ editor }: { editor: Editor }) {
  const menu = useMenuFocus(editor);
  const value = useListValue(editor);
  return (
    <ToolbarMenu
      label="List"
      tooltip="List"
      readOnly={false}
      icon={<ListIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="List"
    >
      <PhoneListMenuItems
        editor={editor}
        value={value}
        onPicked={menu.markPicked}
      />
    </ToolbarMenu>
  );
}

/**
 * The context slot as one cell (spec §4.7): the row's T3 stand-in, a menu
 * of the current block's tools (section, code language, table row and
 * column, media options), absent for paragraphs, lists and the title. The
 * row's `ContextSlot` is not mounted on a phone, so this cell holds the
 * slot while focus is in the bar or its popups: a collaborator's edit never
 * removes the cell (or its menu's return target) under focus. The wrapper
 * always renders, so the hold finds the toolbar even while the cell is
 * empty. Media has one tool, so it is a direct "Media options…" button,
 * as in the row's slot: the kit toolbar it opens takes focus, which a
 * menu's close would hand back to the editor. Below 360px the cell is
 * hidden and the sheet carries its tools. `data-kind` picks the cell's
 * kind icon in `phone.scss` (lazy), so no icon is added here.
 */
function SlotCell({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { kind } = useSlotTarget(editor);
  useToolbarHold(editor, ref);
  return (
    <span ref={ref} className="contents" data-phone-slot="" data-kind={kind}>
      {kind === "media" ? (
        <ActionButton id="media.options" editor={editor} variant="phone" />
      ) : (
        <SlotCollapseButton editor={editor} />
      )}
    </span>
  );
}

/**
 * The phone bar's last cells (spec §4.7): List ▾, Indent, the context
 * slot and Insert ▾.
 * They reuse the row's menu triggers, which the editor chunk already
 * holds (their items are in the menu chunk), so the editor shell renders
 * them and hands them to the lazy bar (`mobile-toolbar-content.tsx`). Importing the menus from the bar's own
 * chunk splits them into a shared chunk and costs the editor chunk group
 * about 1.5 KB gz in lost compression (contract A9).
 */
export function PhoneMenuCells({ editor }: { editor: Editor }) {
  return (
    <>
      <ListCell editor={editor} />
      <ActionButton id="indent.indent" editor={editor} variant="phone" />
      <SlotCell editor={editor} />
      <InsertMenu editor={editor} />
    </>
  );
}
