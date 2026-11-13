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
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  useCommandState,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { announce } from "@/lib/announce";
import { editorActions } from "@/lib/editor-actions";
import {
  ariaKeyShortcuts,
  formatKeyCombo,
} from "@/lib/editor-actions/key-combo";
import { runAction } from "@/lib/editor-actions/registry";
import {
  ENGINE_LOADING_REASON,
  formatsSaveAction,
  getV11Engine,
  loadV11Engine,
} from "@/lib/editor-actions/v11-actions";
import { computeContext } from "@/lib/editor-context/snapshot";
import { CheckIcon } from "@/lib/icons";
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

/**
 * Why `name` cannot be saved, from the engine (loaded before this chunk,
 * so the palette never carries a second copy of the bundle code).
 */
function saveReason(editor: Editor, name: string): string | null {
  const engine = getV11Engine();
  return engine ? engine.formatSaveReason(editor, name) : ENGINE_LOADING_REASON;
}

/** `MAX_FORMAT_NAME` (not imported: it would pull saved-formats in here). */
const NAME_MAX = 40;

/** Pause after the last keystroke before the result count is announced. */
const STATUS_DELAY_MS = 300;

function resultStatus(count: number): string {
  if (count === 0) return "No matching actions";
  return count === 1 ? "1 action" : `${count} actions`;
}

/**
 * Polite live region for search results (WCAG 4.1.3). Rendered for the
 * palette's whole life (a region inserted with its text is often not
 * read), empty until the search changes, then debounced so each keystroke
 * does not interrupt. cmdk's `CommandEmpty` mounts only with no results
 * and is not announced, and with no match the input loses its
 * `aria-activedescendant`, so this is the only feedback. It also reads
 * `notice` (why a row cannot run) at once. Inside the dialog: a modal
 * dialog hides `body`'s other children from assistive tech.
 */
function ResultStatus({ notice }: { notice: string }) {
  const search = useCommandState((state) => state.search);
  const count = useCommandState((state) => state.filtered.count);
  const [message, setMessage] = useState("");
  const searched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!searched.current && search === "") return;
    searched.current = true;
    timer.current = setTimeout(
      () => setMessage(resultStatus(count)),
      STATUS_DELAY_MS,
    );
    return () => clearTimeout(timer.current);
  }, [search, count]);
  // A pending count would talk over the reason.
  useEffect(() => {
    if (!notice) return;
    clearTimeout(timer.current);
    setMessage(notice);
  }, [notice]);
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}

/**
 * Whether E's engine is installed. The host tries to load it before this
 * chunk; if that failed (offline), each open tries again.
 */
function useEngineReady(): boolean {
  const [ready, setReady] = useState(() => getV11Engine() !== null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    loadV11Engine().then(
      () => live && setReady(true),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

/**
 * The rows for this open. `engineReady` is only a revision: when a late
 * engine lands, E's "still loading" rows are read again as real ones.
 */
function readSections(editor: Editor, _engineReady: boolean) {
  return buildPaletteSections({
    ctx: computeContext(editor),
    actions: editorActions.list(),
    recentKeys: readPaletteRecent(),
  });
}

export function CommandPalette({ editor, mode, onClose }: CommandPaletteProps) {
  const reasonPrefix = useId();
  const [view, setView] = useState<PaletteMode>(mode);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Keys the alert, so the same error is read again on each submit.
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const mac = useMemo(() => isMac(), []);
  const engineReady = useEngineReady();
  const sections = useMemo(
    () => readSections(editor, engineReady),
    [editor, engineReady],
  );
  // cmdk highlights its first item on open; make that one Enter can run.
  const firstRunnable = useMemo(
    () =>
      sections
        .flatMap((section) => section.items)
        .find((item) => !item.disabledReason)?.key,
    [sections],
  );

  // Controlled highlight. cmdk 1.1.1 only re-points the input's
  // aria-activedescendant when it moves the highlight itself, so a value
  // set from props (the first runnable item on open) left it empty;
  // `patches/cmdk@1.1.1.patch` re-syncs it on mount and on every `value`
  // change (WCAG 4.1.2, `palette.spec.ts`).
  const [value, setValue] = useState(firstRunnable ?? "");

  const close = () => {
    onClose();
    if (!editor.isDestroyed) editor.view.focus();
  };

  const select = (item: PaletteItem) => {
    if (item.disabledReason) {
      // A trailing no-break space toggles, so the same reason is read again.
      const text = `${item.label}: ${item.disabledReason}`;
      setNotice((last) => (last === text ? `${text}\u00a0` : text));
      return;
    }
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

  const fail = (message: string) => {
    setError(message);
    setAttempt((n) => n + 1);
  };

  const save = () => {
    const reason = saveReason(editor, name);
    if (reason) {
      fail(reason);
      return;
    }
    if (runAction(editor, formatsSaveAction, name)) {
      rememberPaletteRecent(formatsSaveAction.id);
      close();
      // After the dialog (which hides the rest of the page) is gone.
      announce(`Saved format ‘${name.trim()}’`);
    } else {
      fail("This format could not be saved.");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        // Esc in the save view goes back to the list; Esc there closes.
        if (details.reason === "escape-key" && view === "save-format") {
          details.cancel();
          setView("actions");
          return;
        }
        close();
      }}
    >
      <DialogContent
        data-command-palette=""
        showCloseButton={false}
        // The shared ring is a box-shadow, which forced colours drop: give
        // the popup a real edge there (spec §4.5).
        className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg forced-colors:border forced-colors:border-[CanvasText]"
        finalFocus={false}
      >
        {view === "save-format" ? null : (
          <DialogTitle className="sr-only">All actions</DialogTitle>
        )}
        {view === "save-format" ? (
          <form
            className="flex flex-col gap-2 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <DialogTitle>Save as format</DialogTitle>
            <DialogDescription>
              Saves the selection&apos;s marks, colour, highlight and size under
              a name, on this device.
            </DialogDescription>
            <label
              htmlFor={`${reasonPrefix}-name`}
              className="pt-2 text-sm font-medium"
            >
              Name
            </label>
            <Input
              id={`${reasonPrefix}-name`}
              autoFocus
              maxLength={NAME_MAX}
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${reasonPrefix}-hint${error ? ` ${reasonPrefix}-error` : ""}`}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              className="pointer-coarse:h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid"
            />
            <p
              id={`${reasonPrefix}-hint`}
              className="text-xs text-muted-foreground"
            >
              Up to {NAME_MAX} characters
            </p>
            {error ? (
              <p
                key={attempt}
                id={`${reasonPrefix}-error`}
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                className="pointer-coarse:min-h-11"
                onClick={close}
              >
                Cancel
              </Button>
              <Button type="submit" className="pointer-coarse:min-h-11">
                Save
              </Button>
            </div>
          </form>
        ) : (
          <Command
            loop
            label="Search actions"
            value={value}
            onValueChange={setValue}
          >
            {/* Back from the save view: focus returns here. */}
            <CommandInput autoFocus placeholder="Search actions…" />
            <ResultStatus notice={notice} />
            <CommandList label="Actions">
              <CommandEmpty>No matching actions.</CommandEmpty>
              {sections.map((section) => (
                <CommandGroup key={section.heading} heading={section.heading}>
                  {section.items.map((item) => (
                    <CommandItem
                      key={item.key}
                      value={item.key}
                      keywords={[item.label, ...item.keywords]}
                      data-action-id={item.actionId}
                      data-unavailable={item.disabledReason ? "" : undefined}
                      // The glyph is hidden; the option announces the keys.
                      aria-keyshortcuts={
                        item.shortcut
                          ? ariaKeyShortcuts(item.shortcut, mac)
                          : undefined
                      }
                      className={
                        item.disabledReason
                          ? "text-muted-foreground"
                          : undefined
                      }
                      onSelect={() => select(item)}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">
                          {item.label}
                          {/* cmdk forces aria-disabled="false" on items it
                              keeps navigable (spec §6.5), so the state is
                              part of the name. */}
                          {item.current ? (
                            <span className="sr-only">, current</span>
                          ) : null}
                          {item.disabledReason ? (
                            <span className="sr-only">, unavailable</span>
                          ) : null}
                        </span>
                        {item.disabledReason ? (
                          <span className="truncate text-xs">
                            {item.disabledReason}
                          </span>
                        ) : null}
                      </span>
                      {item.current ? (
                        <CheckIcon
                          aria-hidden="true"
                          data-current=""
                          className="ml-auto"
                        />
                      ) : null}
                      {item.shortcut ? (
                        <CommandShortcut
                          aria-hidden="true"
                          className={item.current ? "ml-0" : undefined}
                        >
                          {formatKeyCombo(item.shortcut, mac)}
                        </CommandShortcut>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}
