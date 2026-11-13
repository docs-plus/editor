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
import { defaultFilter } from "cmdk";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { announce } from "@/lib/announce";
import { editorActions } from "@/lib/editor-actions";
import {
  ariaKeyShortcuts,
  formatKeyCombo,
} from "@/lib/editor-actions/key-combo";
import { runAction } from "@/lib/editor-actions/registry";
import {
  formatsSaveAction,
  getV11Engine,
  loadV11Engine,
} from "@/lib/editor-actions/v11-actions";
import { computeContext } from "@/lib/editor-context/snapshot";
import { CheckIcon } from "@/lib/icons";
import "./command-palette.scss";
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
  /**
   * Opens "Remove a format ▸" (the Save view's link at the cap); true when
   * a listener took it. From the host, so this chunk imports no UI intents.
   */
  onRemoveFormat: () => boolean;
}

/**
 * The Save view (design pass §7): its own chunk, fetched when it opens. A
 * failure reaches the host's boundary, which closes the palette and says
 * so.
 */
const SaveFormatForm = lazy(() =>
  import("./save-format-form").then((module) => ({
    default: module.SaveFormatForm,
  })),
);

/**
 * cmdk's scorer over the label and keywords first, the item key (an action
 * id) last, so "repeat" ranks Repeat formatting over Copy formatting
 * (`repeat.copy`), which still matches.
 */
const labelFirst = (value: string, search: string, keywords?: string[]) =>
  defaultFilter(keywords?.join(" ") ?? "", search, [value]);

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

/**
 * The row's leading `size-4` slot: the colour's chip, else the registry
 * icon (design pass §8). Empty slots keep the labels aligned.
 */
function Lead({ item }: { item: PaletteItem }) {
  const Icon = item.icon;
  const swatch = item.swatch;
  return (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center">
      {swatch ? (
        <span
          className={`st-chip st-chip--${swatch.kind}`}
          data-token={swatch.token ?? "none"}
        >
          {swatch.kind === "text" ? "A" : null}
        </span>
      ) : Icon ? (
        <Icon />
      ) : null}
    </span>
  );
}

/**
 * One option. An unavailable one keeps its label at full contrast, with
 * its reason as a muted second line and no shortcut (design pass §8).
 */
function PaletteRow({
  item,
  mac,
  onSelect,
}: {
  item: PaletteItem;
  mac: boolean;
  onSelect: () => void;
}) {
  const reason = item.disabledReason;
  const second = reason ?? item.detail;
  const shortcut = reason ? undefined : item.shortcut;
  return (
    <CommandItem
      value={item.key}
      keywords={[item.label, ...item.keywords]}
      data-action-id={item.actionId}
      data-unavailable={reason ? "" : undefined}
      // The glyph is hidden; the option announces the keys.
      aria-keyshortcuts={shortcut ? ariaKeyShortcuts(shortcut, mac) : undefined}
      className={second ? "min-h-12" : "min-h-8"}
      onSelect={onSelect}
    >
      <Lead item={item} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">
          {item.label}
          {/* cmdk forces aria-disabled="false" on items it keeps
              navigable (spec §6.5), so the state is part of the name. */}
          {item.current ? <span className="sr-only">, current</span> : null}
          {reason ? <span className="sr-only">, unavailable</span> : null}
        </span>
        {second ? (
          <span className="truncate text-xs text-muted-foreground in-data-[selected=true]:text-foreground/70">
            {second}
          </span>
        ) : null}
      </span>
      {item.current ? (
        <CheckIcon aria-hidden="true" data-current="" className="ml-auto" />
      ) : null}
      {shortcut ? (
        <CommandShortcut
          aria-hidden="true"
          className={item.current ? "ml-0" : undefined}
        >
          {formatKeyCombo(shortcut, mac)}
        </CommandShortcut>
      ) : null}
    </CommandItem>
  );
}

export function CommandPalette({
  editor,
  mode,
  onClose,
  onRemoveFormat,
}: CommandPaletteProps) {
  const [view, setView] = useState<PaletteMode>(mode);
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

  const save = (name: string) => {
    if (!runAction(editor, formatsSaveAction, name)) return false;
    rememberPaletteRecent(formatsSaveAction.id);
    close();
    // After the dialog (which hides the rest of the page) is gone.
    announce(`Saved format ‘${name}’`);
    return true;
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
          <Suspense fallback={<div className="h-80" />}>
            <SaveFormatForm
              editor={editor}
              onClose={close}
              onSave={save}
              onRemoveFormat={onRemoveFormat}
            />
          </Suspense>
        ) : (
          <Command
            loop
            label="Search actions"
            value={value}
            onValueChange={setValue}
            filter={labelFirst}
          >
            {/* Back from the save view: focus returns here. */}
            <CommandInput autoFocus placeholder="Search actions…" />
            <ResultStatus notice={notice} />
            <CommandList label="Actions">
              <CommandEmpty>No matching actions.</CommandEmpty>
              {sections.map((section) => (
                <CommandGroup key={section.heading} heading={section.heading}>
                  {section.items.map((item) => (
                    <PaletteRow
                      key={item.key}
                      item={item}
                      mac={mac}
                      onSelect={() => select(item)}
                    />
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
