"use client";

/**
 * The action palette (spec §4.4, M11). Lazy chunk: loaded on the first
 * Alt+/ by `CommandPaletteHost`. Mounted only while open, so each open
 * takes a fresh snapshot of the context and Recent and nothing lingers
 * after close. It never captures or rebuilds the selection: ProseMirror
 * keeps it while focus is in the dialog (a NodeSelection or CellSelection
 * stays one), and y-tiptap remaps it across remote edits.
 */
import type { Editor } from "@tiptap/core";
import { useId, useMemo, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  bundleFace,
  isEmptyBundle,
  readBundleAt,
  setEntries,
} from "@/extensions/repeat-formatting/bundle";
import { editorActions } from "@/lib/editor-actions";
import { formatKeyCombo } from "@/lib/editor-actions/key-combo";
import { runAction } from "@/lib/editor-actions/registry";
import { formatsSaveAction } from "@/lib/editor-actions/v11-actions";
import { computeContext } from "@/lib/editor-context/snapshot";
import {
  FORMAT_REASONS,
  MAX_SAVED_FORMATS,
  readSavedFormats,
  sanitizeFormatName,
} from "@/lib/saved-formats";
import { isMac } from "@/lib/shortcuts";

import { readPaletteRecent, rememberPaletteRecent } from "./palette-recent";
import {
  buildPaletteSections,
  type PaletteItem,
  recentKeyOf,
} from "./palette-sections";
import type { PaletteMode } from "./palette-store";

export interface CommandPaletteProps {
  editor: Editor;
  mode: PaletteMode;
  onClose: () => void;
}

function saveReason(editor: Editor, name: string): string | null {
  const cleanName = sanitizeFormatName(name);
  if (!cleanName) return FORMAT_REASONS.name;
  if (isEmptyBundle(setEntries(readBundleAt(editor.state)))) {
    return FORMAT_REASONS.empty;
  }
  const formats = readSavedFormats();
  const exists = formats.some(
    (format) => format.name.toLowerCase() === cleanName.toLowerCase(),
  );
  if (!exists && formats.length >= MAX_SAVED_FORMATS) return FORMAT_REASONS.cap;
  return null;
}

export function CommandPalette({ editor, mode, onClose }: CommandPaletteProps) {
  const reasonPrefix = useId();
  const [view, setView] = useState<PaletteMode>(mode);
  const [name, setName] = useState(() =>
    bundleFace(setEntries(readBundleAt(editor.state))),
  );
  const [error, setError] = useState<string | null>(null);
  const mac = useMemo(() => isMac(), []);
  const sections = useMemo(
    () =>
      buildPaletteSections({
        ctx: computeContext(editor),
        actions: editorActions.list(),
        recentKeys: readPaletteRecent(),
      }),
    [editor],
  );

  const close = () => {
    onClose();
    if (!editor.isDestroyed) editor.view.focus();
  };

  const select = (item: PaletteItem) => {
    if (item.disabledReason) return;
    if (item.actionId === formatsSaveAction.id && item.arg === undefined) {
      setView("save-format");
      return;
    }
    const action = editorActions.get(item.actionId);
    close();
    if (!action || editor.isDestroyed) return;
    if (runAction(editor, action, item.arg)) {
      rememberPaletteRecent(recentKeyOf(item));
    }
  };

  const save = () => {
    const reason = saveReason(editor, name);
    if (reason) {
      setError(reason);
      return;
    }
    if (runAction(editor, formatsSaveAction, name)) {
      rememberPaletteRecent(formatsSaveAction.id);
      close();
    } else {
      setError("This format could not be saved.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent
        data-command-palette=""
        showCloseButton={false}
        className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
        finalFocus={false}
      >
        <DialogTitle className="sr-only">
          {view === "save-format" ? "Save as format" : "All actions"}
        </DialogTitle>
        {view === "save-format" ? (
          <form
            className="flex flex-col gap-2 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label
              htmlFor={`${reasonPrefix}-name`}
              className="text-sm font-medium"
            >
              Name
            </label>
            <input
              id={`${reasonPrefix}-name`}
              autoFocus
              maxLength={160}
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${reasonPrefix}-error` : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              className="h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {error ? (
              <p
                id={`${reasonPrefix}-error`}
                className="text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="h-8 rounded-md px-3 text-sm hover:bg-accent"
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground"
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <Command loop>
            <CommandInput placeholder="Search actions…" />
            <CommandList>
              <CommandEmpty>No matching actions.</CommandEmpty>
              {sections.map((section) => (
                <CommandGroup key={section.heading} heading={section.heading}>
                  {section.items.map((item) => {
                    const reasonId = item.disabledReason
                      ? `${reasonPrefix}-${item.key.replace(/[^\w-]/g, "_")}`
                      : undefined;
                    return (
                      <CommandItem
                        key={item.key}
                        value={item.key}
                        keywords={[item.label, ...item.keywords]}
                        data-action-id={item.actionId}
                        data-unavailable={item.disabledReason ? "" : undefined}
                        aria-describedby={reasonId}
                        className={
                          item.disabledReason
                            ? "text-muted-foreground"
                            : undefined
                        }
                        onSelect={() => select(item)}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{item.label}</span>
                          {item.disabledReason ? (
                            <span id={reasonId} className="truncate text-xs">
                              {item.disabledReason}
                            </span>
                          ) : null}
                        </span>
                        {item.shortcut ? (
                          <CommandShortcut>
                            {formatKeyCombo(item.shortcut, mac)}
                          </CommandShortcut>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}
