"use client";

/**
 * The row menu (right-click, Shift+F10, the Menu key) for documents and
 * folders. The desktop shell can show the same items in a native menu
 * (`Menu.popup`, UX §2.5) from `itemMenuEntries`; the web library and the
 * harness render this one. Closing it returns focus to the row (plan §5.6).
 */
import { useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { pinnedEntries } from "@/lib/library/tree-rows";
import type {
  LibraryIndexSnapshot,
  LibraryItemRef,
} from "@/lib/platform/document-index";
import { isMac } from "@/lib/shortcuts";

import { type LibraryActions, useLibrary } from "./library-context";

/** A pointer position or the row element. */
export type MenuAnchor = HTMLElement | { x: number; y: number };

export interface ItemMenuEntry {
  id: string;
  label: string;
  /** Shown as a hint; the tree binds the keys. */
  shortcut?: string;
  destructive?: boolean;
  run: () => void;
}

/** The menu for one item, in display order; `null` is a separator. */
export function itemMenuEntries(
  item: LibraryItemRef,
  snapshot: LibraryIndexSnapshot,
  actions: LibraryActions,
  options: { pinnedRow: boolean; mac: boolean },
): (ItemMenuEntry | null)[] {
  const { mac } = options;
  const trash: ItemMenuEntry = {
    id: "trash",
    label: "Move to Trash",
    shortcut: mac ? "⌘⌫" : "Delete",
    destructive: true,
    run: () => actions.trash([item]),
  };
  const rename: ItemMenuEntry = {
    id: "rename",
    label: "Rename",
    shortcut: "F2",
    run: () => actions.startRename(item),
  };
  const moveTo: ItemMenuEntry = {
    id: "move-to",
    label: "Move to…",
    run: () => actions.openMoveTo([item]),
  };
  if (item.kind === "folder") {
    return [
      {
        id: "new-doc",
        label: "New Document",
        run: () => actions.createDocument(item.id),
      },
      {
        id: "new-folder",
        label: "New Folder",
        shortcut: mac ? "⇧⌘N" : "Ctrl+Shift+N",
        run: () => actions.createFolder(item.id),
      },
      null,
      rename,
      moveTo,
      null,
      trash,
    ];
  }
  const doc = snapshot.items.find((entry) => entry.id === item.id);
  const pinned = pinnedEntries(snapshot);
  const at = pinned.findIndex((entry) => entry.id === item.id);
  const entries: (ItemMenuEntry | null)[] = [
    { id: "open", label: "Open", run: () => actions.open(item.id) },
    {
      id: "open-tab",
      label: "Open in New Tab",
      shortcut: mac ? "⌘↵" : "Ctrl+Enter",
      run: () => actions.open(item.id, "tab"),
    },
    null,
    rename,
    moveTo,
    doc?.pinKey === undefined
      ? { id: "pin", label: "Pin", run: () => actions.pin(item.id) }
      : { id: "unpin", label: "Unpin", run: () => actions.unpin(item.id) },
  ];
  if (options.pinnedRow && at >= 0) {
    if (at > 0) {
      entries.push({
        id: "pin-up",
        label: "Move Up",
        run: () => actions.movePin(item.id, at - 1),
      });
    }
    if (at < pinned.length - 1) {
      entries.push({
        id: "pin-down",
        label: "Move Down",
        run: () => actions.movePin(item.id, at + 1),
      });
    }
  }
  entries.push(null, trash);
  return entries;
}

function anchorFor(anchor: MenuAnchor) {
  if (anchor instanceof HTMLElement) return anchor;
  const { x, y } = anchor;
  return {
    getBoundingClientRect: () =>
      DOMRect.fromRect({ x, y, width: 0, height: 0 }),
  };
}

/** Entries that move focus themselves (a field, a dialog, the editor). */
const MOVES_FOCUS = new Set([
  "open",
  "rename",
  "move-to",
  "new-doc",
  "new-folder",
]);

export function ItemMenu({
  item,
  anchor,
  pinned,
  onClose,
}: {
  item: LibraryItemRef;
  anchor: MenuAnchor;
  pinned: boolean;
  /** `keepFocus`: the chosen entry moves focus itself. */
  onClose: (keepFocus: boolean) => void;
}) {
  const { snapshot, actions } = useLibrary();
  const [open, setOpen] = useState(true);
  const chosen = useRef<ItemMenuEntry | null>(null);
  const settled = useRef(false);
  const entries = itemMenuEntries(item, snapshot, actions, {
    pinnedRow: pinned,
    mac: isMac(),
  });
  // The menu closes on a choice and on Esc or an outside click, in either
  // order: settle once, a frame later, so the menu has let go of focus.
  const settle = () => {
    if (settled.current) return;
    settled.current = true;
    setOpen(false);
    requestAnimationFrame(() => {
      const entry = chosen.current;
      onClose(entry ? MOVES_FOCUS.has(entry.id) : false);
      entry?.run();
    });
  };
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) settle();
      }}
    >
      <DropdownMenuContent
        anchor={anchorFor(anchor)}
        align="start"
        className="lib-menu"
        aria-label="Actions"
      >
        {entries.map((entry, at) =>
          entry ? (
            <DropdownMenuItem
              key={entry.id}
              variant={entry.destructive ? "destructive" : "default"}
              onClick={() => {
                chosen.current = entry;
                settle();
              }}
              data-menu-id={entry.id}
            >
              {entry.label}
              {entry.shortcut ? (
                <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut>
              ) : null}
            </DropdownMenuItem>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
            <DropdownMenuSeparator key={`sep-${at}`} />
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
