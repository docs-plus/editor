"use client";

import type { Editor } from "@tiptap/core";
import {
  type CSSProperties,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  closeSlash,
  getSlashState,
  type SlashState,
} from "@/extensions/slash-trigger/slash-trigger";
import { editorActions } from "@/lib/editor-actions";
import { computeContext } from "@/lib/editor-context/snapshot";
import { SCROLL_CLEARANCE } from "@/lib/editor-scroll-clearance";
import { readChoice, TABLE_SIZE_CHOICE } from "@/lib/remembered-choice";
import { isPlusSlash } from "@/lib/slash-menu/plus-origin";
import { runSlashPick } from "@/lib/slash-menu/run-slash-pick";
import { isNewItem, localDay } from "@/lib/slash-menu/slash-badges";
import {
  buildSlashItems,
  hintNeedsSpace,
  matchSlashItems,
  recentInsertKinds,
  type SlashItem,
  type SlashSection,
  slashEmptyNote,
} from "@/lib/slash-menu/slash-items";
import {
  pageIndex,
  type RowSpan,
  type SlashKey,
  slashKey,
  stepIndex,
} from "@/lib/slash-menu/slash-keys";
import { cn } from "@/lib/utils";

/*
 * The "/" block menu (lazy chunk, loaded on idle and on the first "/").
 * Import rule: modules the editor chunk already has, and this folder.
 * Never the palette, the menu chunk's `components/ui/dropdown-menu`, or
 * `components/smart-toolbar/row/**` (A7, A9).
 */

type OpenSlashState = Extract<SlashState, { open: true }>;

export interface SlashMenuProps {
  editor: Editor;
  state: OpenSlashState;
  /** Sets the host's polite live region. */
  announce: (message: string) => void;
}

const WIDTH = 320;
/** Room for Text, Lists and the start of Insert at 32 px rows (the footer adds its own). */
const MAX_HEIGHT = 340;
/** Below this, the list flips above the caret if there is more room. */
const MIN_HEIGHT = 160;
const GAP = 6;
const EDGE = 8;
const SLACK = 2;
/** The phone's docked bar (`mobile-toolbar-content.tsx`). */
const DOCKED_BAR = '[data-slot="toolbar"][data-variant="docked"]';
/** Below this width the list spans the screen, 16 px in from each side. */
const NARROW = 640;
const GUTTER = 16;
/** Fast arrows announce once, not in a burst (WCAG 4.1.3). */
const ANNOUNCE_DELAY_MS = 150;
/** Set on the editor while open (never `aria-expanded`: not on a textbox). */
const COMBOBOX_ATTRS = ["aria-haspopup", "aria-autocomplete", "aria-controls"];

const isCoarse = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/** The paragraph holding `pos` (the menu opens only in one). */
function blockAt(editor: Editor, pos: number): HTMLElement | null {
  const { node } = editor.view.domAtPos(pos);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest("p") ?? element;
}

/** The block's own direction (the content's, not the interface's). */
const isRtl = (block: HTMLElement | null) =>
  block ? getComputedStyle(block).direction === "rtl" : false;

/**
 * Esc and Close: the menu closes and "/query" stays as typed text, except
 * a bare "/" the `+` typed, which goes as it came, outside the history.
 */
function dismiss(editor: Editor): void {
  const state = getSlashState(editor);
  if (state.open && !state.query && isPlusSlash(editor)) {
    // Without its "/" the trigger closes.
    editor.view.dispatch(
      editor.state.tr
        .delete(state.from, state.from + 1)
        .setMeta("addToHistory", false),
    );
    return;
  }
  closeSlash(editor);
}

interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  /** Under the caret (true) or above it. */
  down: boolean;
}

/**
 * Under the "/" when the list fits there, else above it if there is more
 * room, always inside the band between the sticky row and the phone bar
 * and keyboard (`SCROLL_CLEARANCE`, WCAG 2.4.11), never over the caret
 * line. Null while the caret itself is outside that band (scrolled away,
 * or under the keyboard): the list never floats apart from its caret.
 * `side` keeps the side chosen at open while it still fits, so typing
 * never flips the list. A list taller than its room ends halfway through
 * a row, so the cut row shows there is more; the footer stays under it.
 * In an RTL paragraph the list's right edge is at the "/", else its left
 * edge. Viewport coordinates.
 */
function place(
  editor: Editor,
  from: number,
  list: HTMLElement,
  side: boolean | null,
  rtl: boolean,
): Placement | null {
  // The empty-state note and the footer sit outside the listbox; measure
  // them too.
  const note =
    list.parentElement?.querySelector<HTMLElement>("[data-slash-empty]");
  const footer =
    list.parentElement?.querySelector<HTMLElement>("[data-slash-footer]")
      ?.offsetHeight ?? 0;
  const caret = editor.view.coordsAtPos(from);
  const frame = editor.view.dom
    .closest(".document-editor-wrapper")
    ?.getBoundingClientRect();
  const top = Math.max(frame?.top ?? 0, 0) + SCROLL_CLEARANCE.top;
  // The phone bar's own place, and the keyboard's (the bar rides on it),
  // so a clearance not yet updated for the keyboard never lets the list
  // over them.
  const bar = document.querySelector<HTMLElement>(DOCKED_BAR);
  const viewport = window.visualViewport;
  const keyboard = viewport
    ? viewport.offsetTop + viewport.height - (bar?.offsetHeight ?? 0)
    : Number.POSITIVE_INFINITY;
  const bottom = Math.min(
    Math.min(frame?.bottom ?? window.innerHeight, window.innerHeight) -
      SCROLL_CLEARANCE.bottom,
    (bar?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) - EDGE,
    keyboard - EDGE,
  );
  // ProseMirror scrolls the caret to the band edge, give or take a pixel.
  if (caret.top < top - SLACK || caret.bottom > bottom + SLACK) return null;
  const below = bottom - caret.bottom - GAP;
  const above = caret.top - top - GAP;
  // Content plus the popup's 1 px borders.
  const height = list.scrollHeight + (note?.offsetHeight ?? 0) + footer + 2;
  const cap = MAX_HEIGHT + footer;
  const wanted = Math.min(height, cap);
  const fits = (room: number) => room >= Math.min(wanted, MIN_HEIGHT);
  const down =
    side !== null && fits(side ? below : above)
      ? side
      : fits(below) || below >= above;
  let maxHeight = Math.max(Math.min(cap, down ? below : above), 0);
  if (height > maxHeight) {
    // The middle of the first row that does not fit, or of the one before
    // it when that middle is out of room too (a heading sits between).
    const room = maxHeight - footer;
    let cut = room;
    for (const row of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      const middle = row.offsetTop + row.offsetHeight / 2;
      if (row.offsetTop + row.offsetHeight > room) {
        if (middle <= room) cut = middle;
        break;
      }
      cut = middle;
    }
    maxHeight = cut + footer;
  }
  const narrow = window.innerWidth < NARROW;
  const width = narrow ? window.innerWidth - 2 * GUTTER : WIDTH;
  return {
    top: down
      ? caret.bottom + GAP
      : caret.top - GAP - Math.min(height, maxHeight),
    left: narrow
      ? GUTTER
      : Math.min(
          Math.max(rtl ? caret.left - width : caret.left, EDGE),
          window.innerWidth - width - EDGE,
        ),
    width,
    maxHeight,
    down,
  };
}

/** The popup's place; hidden until placed, and while its caret is out of view. */
function styleOf(placement: Placement | null): CSSProperties {
  return placement
    ? {
        top: `${placement.top}px`,
        left: `${placement.left}px`,
        width: `${placement.width}px`,
        maxHeight: `${placement.maxHeight}px`,
        visibility: "visible",
      }
    : { top: "0px", left: "0px", width: `${WIDTH}px`, visibility: "hidden" };
}

const optionId = (listbox: string, item: SlashItem) =>
  `${listbox}-${item.key.replace(/[^\w-]/g, "-")}`;

/** Each option's span in the list; headings are the gaps between them. */
const rowSpans = (box: HTMLElement): RowSpan[] =>
  Array.from(box.querySelectorAll<HTMLElement>('[role="option"]'), (row) => ({
    top: row.offsetTop,
    bottom: row.offsetTop + row.offsetHeight,
  }));

/** The option a move key lands on; the page keys measure the list. */
function moveTarget(
  key: Exclude<SlashKey, "Enter" | "Escape">,
  index: number,
  count: number,
  box: HTMLElement | null,
): number {
  if (key !== "PageUp" && key !== "PageDown") {
    return stepIndex(key, index, count);
  }
  if (!box) return -1;
  return pageIndex(rowSpans(box), index, box.clientHeight, key === "PageDown");
}

function sections(items: readonly SlashItem[]) {
  const groups: { section: SlashSection; items: SlashItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last?.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

/** "Table, 3 by 3, 9 of 18": the visible note, spoken ("×" reads badly). */
function optionMessage(
  item: SlashItem,
  index: number,
  count: number,
  isNew: boolean,
) {
  const note = item.note ? `, ${item.note.replace(" × ", " by ")}` : "";
  const badge = isNew ? ", new" : "";
  return `${item.label}${badge}${note}, ${index + 1} of ${count}`;
}

/**
 * The ghost hint, on the caret's line just after the "/" (before it, in
 * an RTL paragraph), in the paragraph's own font. Viewport coordinates.
 */
function placeGhost(editor: Editor, from: number, ghost: HTMLElement) {
  const at = editor.view.coordsAtPos(editor.state.selection.head);
  const block = blockAt(editor, from);
  const style = ghost.style;
  if (block) {
    const font = getComputedStyle(block);
    style.fontFamily = font.fontFamily;
    style.fontSize = font.fontSize;
    style.fontWeight = font.fontWeight;
    style.fontStyle = font.fontStyle;
    style.letterSpacing = font.letterSpacing;
  }
  style.top = `${at.top}px`;
  style.lineHeight = style.height = `${at.bottom - at.top}px`;
  const rtl = isRtl(block);
  style.left = rtl ? "" : `${at.left}px`;
  style.right = rtl
    ? `${document.documentElement.clientWidth - at.left}px`
    : "";
}

/**
 * The listbox under the caret. Focus stays in the editor: ↑, ↓, Home,
 * End, Page Up, Page Down, Enter and Esc aimed at it are taken here, in
 * the window's capture phase before ProseMirror and its keymaps see them
 * (as the palette does); the active row scrolls into view; rows never
 * take focus (`mousedown` is prevented, so a tap keeps the phone
 * keyboard); and the editor points at the active row with
 * `aria-activedescendant`. The editor's combobox attributes are set on
 * its DOM while the menu is mounted: ProseMirror leaves attributes it did
 * not set alone and ignores attribute changes on its root, so no
 * transaction, no `setOptions`.
 */
export function SlashMenu({ editor, state, announce }: SlashMenuProps) {
  const listbox = `slash-menu-${useId().replace(/[^\w-]/g, "")}`;
  // Once per open: the menu unmounts when it closes.
  const [{ items, fresh }] = useState(() => {
    const recent = recentInsertKinds();
    const built = buildSlashItems(
      computeContext(editor),
      editorActions.list(),
      readChoice(TABLE_SIZE_CHOICE).last,
      recent,
    );
    const today = localDay();
    return {
      items: built,
      /** Keys of the rows that show "New". */
      fresh: new Set(
        built
          .filter((item) => isNewItem(item, today, recent))
          .map((item) => item.key),
      ),
    };
  });
  const [composing, setComposing] = useState(() => editor.view.composing);
  const [coarse] = useState(isCoarse);
  const matches = useMemo(
    () => matchSlashItems(items, state.query),
    [items, state.query],
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const found = matches.findIndex((item) => item.key === activeKey);
  // A bare "/" has no active row (Enter stays a line break: a line may
  // end in " /") until an arrow or the pointer picks one; a query's best
  // match is active.
  const activeIndex = found >= 0 ? found : state.query ? 0 : -1;
  const active = matches[activeIndex] ?? null;
  const activeOption = active ? optionId(listbox, active) : null;
  const empty = matches.length ? "" : slashEmptyNote(items, state.query);
  // The ghost: an empty query, nothing after the caret in its block, and
  // no IME composition (spec §8.5).
  const { $head } = editor.state.selection;
  const ghostShown =
    !state.query &&
    !composing &&
    $head.parentOffset === $head.parent.content.size;
  const ghost = useRef<HTMLSpanElement>(null);

  // The best match leads each new query.
  const query = useRef(state.query);
  if (query.current !== state.query) {
    query.current = state.query;
    if (activeKey !== null) setActiveKey(null);
  }

  const latest = useRef({ matches, activeIndex, active });
  latest.current = { matches, activeIndex, active };
  /** The list is on screen (its caret is inside the band). */
  const shown = useRef(false);
  const list = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const used = (event: KeyboardEvent) => {
      const key = slashKey(event, editor.view);
      const { matches: all, activeIndex: index, active: item } = latest.current;
      if (key === "Escape") {
        dismiss(editor);
        return true;
      }
      // A hidden list (its caret scrolled away) takes only Esc.
      if (!key || all.length === 0 || !shown.current) return false;
      if (key === "Enter") {
        if (!item) return false;
        runSlashPick(editor, item);
        return true;
      }
      const target = all[moveTarget(key, index, all.length, list.current)];
      if (target) setActiveKey(target.key);
      return true;
    };
    const onKey = (event: KeyboardEvent) => {
      if (!used(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor]);

  useLayoutEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute("aria-haspopup", "listbox");
    dom.setAttribute("aria-autocomplete", "list");
    dom.setAttribute("aria-controls", listbox);
    return () => {
      for (const name of COMBOBOX_ATTRS) dom.removeAttribute(name);
    };
  }, [editor, listbox]);

  useEffect(() => {
    const dom = editor.view.dom;
    const start = () => setComposing(true);
    const end = () => setComposing(false);
    dom.addEventListener("compositionstart", start);
    dom.addEventListener("compositionend", end);
    return () => {
      dom.removeEventListener("compositionstart", start);
      dom.removeEventListener("compositionend", end);
    };
  }, [editor]);

  // A finished word that matches nothing: the writer moved on.
  useEffect(() => {
    if (!matches.length && /\s$/.test(state.query)) closeSlash(editor);
  }, [matches.length, state.query, editor]);

  // Clear the region on close, so the next open's first message is new.
  useEffect(() => () => announce(""), [announce]);

  /** The first message of an open says that a menu opened. */
  const opened = useRef(false);
  useEffect(() => {
    let message = active
      ? optionMessage(
          active,
          activeIndex,
          matches.length,
          fresh.has(active.key),
        )
      : empty;
    if (!opened.current) {
      const count = `${matches.length} option${matches.length === 1 ? "" : "s"}`;
      message = `Block menu, ${count}.${message ? ` ${message}` : ""}`;
    }
    const timer = setTimeout(() => {
      opened.current = true;
      announce(message);
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, activeIndex, matches.length, empty, announce, fresh]);

  const popup = useRef<HTMLDivElement>(null);
  const side = useRef<boolean | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // Placed before paint, and again on every query, scroll, resize and
  // move of the caret (content above it changing size: a diagram
  // rendering, an image loading, which need not resize the editor). A
  // move is seen in the next frame, in document coordinates (so a scroll
  // is not one), and applied to the popup in that same frame, so it never
  // paints in the old place. When the caret is out of view after a change
  // of layout, ProseMirror scrolls it back with `SCROLL_CLEARANCE` and the
  // scroll re-places the list; never after the writer's own scroll, and
  // after a move only while the list was in view (a collaborator's edit
  // never pulls back a writer who scrolled away).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-placed when the query or the rows change
  useLayoutEffect(() => {
    let frame = 0;
    let follow = true;
    const scroller = editor.view.dom.closest(".document-editor-wrapper");
    /** Where the "/" is now, or null once the menu has closed. */
    const slash = () => {
      const now = getSlashState(editor);
      return now.open ? now.from : null;
    };
    const caretInDocument = (from: number) =>
      editor.view.coordsAtPos(from).top + (scroller?.scrollTop ?? 0);
    let anchor = Number.NaN;
    const update = () => {
      frame = 0;
      const from = slash();
      if (from === null || !list.current) return;
      const next = place(
        editor,
        from,
        list.current,
        side.current,
        isRtl(blockAt(editor, from)),
      );
      if (!next && follow) {
        editor.view.dispatch(editor.state.tr.scrollIntoView());
      }
      follow = false;
      shown.current = next !== null;
      side.current = next?.down ?? side.current;
      anchor = caretInDocument(from);
      if (popup.current) Object.assign(popup.current.style, styleOf(next));
      if (ghost.current) {
        placeGhost(editor, from, ghost.current);
        ghost.current.style.visibility = next ? "visible" : "hidden";
      }
      setPlacement(next);
    };
    update();
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    // The window, the keyboard or the phone bar's clearance (a style on
    // the wrapper) changed: bring the caret back if it went under them.
    const viewportChange = () => {
      follow = true;
      schedule();
    };
    let watching = 0;
    const watch = () => {
      watching = requestAnimationFrame(watch);
      const from = slash();
      if (from === null || frame) return;
      if (Math.abs(caretInDocument(from) - anchor) < 1) return;
      follow = shown.current;
      update();
    };
    watching = requestAnimationFrame(watch);
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", viewportChange);
    window.visualViewport?.addEventListener("resize", viewportChange);
    const clearance = new MutationObserver(viewportChange);
    if (scroller) {
      clearance.observe(scroller, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(watching);
      clearance.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", viewportChange);
      window.visualViewport?.removeEventListener("resize", viewportChange);
    };
  }, [editor, state.from, state.query, matches.length, ghostShown]);

  // Never pointing into a hidden list (its caret scrolled away).
  const visible = placement !== null;
  useLayoutEffect(() => {
    const dom = editor.view.dom;
    if (activeOption && visible) {
      dom.setAttribute("aria-activedescendant", activeOption);
    }
    return () => dom.removeAttribute("aria-activedescendant");
  }, [editor, activeOption, visible]);

  // Keep the active row in view inside the list (never scroll the page).
  useLayoutEffect(() => {
    const box = list.current;
    const row = activeOption ? document.getElementById(activeOption) : null;
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (
      row.offsetTop + row.offsetHeight >
      box.scrollTop + box.clientHeight
    )
      box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
  }, [activeOption]);

  const tip = active?.hint ? (
    <>
      Type{" "}
      <code dir="ltr" className="font-mono text-foreground">
        {active.hint}
      </code>
      {hintNeedsSpace(active.hint) ? " then space" : ""} for {active.label}
    </>
  ) : !state.query && !ghostShown ? (
    "Type to filter"
  ) : (
    "↑ ↓ to move · ↵ to insert"
  );

  return createPortal(
    <>
      {ghostShown ? (
        <span
          ref={ghost}
          data-slash-ghost=""
          aria-hidden="true"
          className="pointer-events-none fixed z-50 whitespace-pre text-muted-foreground"
          style={{ visibility: "hidden" }}
        >
          Type to search
        </span>
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only keeps focus in the editor; nothing here is operable by itself */}
      <div
        ref={popup}
        data-slash-menu=""
        className="fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-100"
        style={styleOf(placement)}
        // Rows never take focus; the editor keeps it (and the keyboard).
        onMouseDown={(event) => event.preventDefault()}
      >
        {empty ? (
          <p
            data-slash-empty=""
            className="px-3 py-2 text-sm text-muted-foreground"
          >
            {empty}
          </p>
        ) : null}
        {/* Empty without a match: only options and groups belong in it. */}
        <div
          ref={list}
          id={listbox}
          role="listbox"
          aria-label="Blocks"
          className="min-h-0 overflow-y-auto overscroll-contain p-1 empty:hidden"
        >
          {sections(matches).map(({ section, items: rows }) => (
            <div
              key={section}
              role="group"
              aria-labelledby={`${listbox}-${section}`}
              className="not-first:mt-1"
            >
              <div
                id={`${listbox}-${section}`}
                className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
              >
                {section}
              </div>
              {rows.map((item) => {
                const id = optionId(listbox, item);
                const selected = id === activeOption;
                const Icon = item.icon;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: keys reach the menu through the editor (aria-activedescendant)
                  // biome-ignore lint/a11y/useFocusableInteractive: options never take focus; the editor points at them (aria-activedescendant)
                  <div
                    key={item.key}
                    id={id}
                    role="option"
                    aria-selected={selected}
                    aria-label={
                      fresh.has(item.key) ? `${item.label}, new` : undefined
                    }
                    data-key={item.key}
                    data-selected={selected ? "true" : undefined}
                    className={cn(
                      "relative flex cursor-default items-center gap-2 rounded-md px-2 text-sm select-none",
                      coarse ? "min-h-11" : "min-h-8",
                      "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                      // Never colour alone (WCAG 1.4.11): a focus-ring bar,
                      // and Highlight in forced colours.
                      "data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-1 data-[selected=true]:before:start-0 data-[selected=true]:before:w-0.5 data-[selected=true]:before:rounded-full data-[selected=true]:before:bg-focus-ring data-[selected=true]:before:content-['']",
                      "forced-colors:data-[selected=true]:forced-color-adjust-none forced-colors:data-[selected=true]:bg-[Highlight] forced-colors:data-[selected=true]:text-[HighlightText] forced-colors:data-[selected=true]:before:bg-[HighlightText]",
                    )}
                    onMouseMove={() => {
                      if (!selected) setActiveKey(item.key);
                    }}
                    onClick={() => runSlashPick(editor, item)}
                  >
                    {Icon ? (
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                    ) : (
                      <span aria-hidden="true" className="size-4 shrink-0" />
                    )}
                    <span className="truncate">{item.label}</span>
                    {fresh.has(item.key) ? (
                      <span
                        aria-hidden="true"
                        data-slash-new=""
                        className="shrink-0 rounded-sm bg-muted px-1 text-xs leading-4 font-medium text-foreground"
                      >
                        New
                      </span>
                    ) : null}
                    {item.note ? (
                      <span
                        aria-hidden="true"
                        className="ms-auto shrink-0 ps-3 text-xs text-muted-foreground tabular-nums in-data-[selected=true]:text-accent-foreground forced-colors:in-data-[selected=true]:text-[HighlightText]"
                      >
                        {item.note}
                      </span>
                    ) : null}
                    {item.hint ? (
                      // Typed syntax, as a key cap (sans notes stay plain).
                      <span
                        aria-hidden="true"
                        className={cn(
                          "shrink-0 rounded-sm border px-1 font-mono text-xs leading-4 text-muted-foreground in-data-[selected=true]:text-accent-foreground forced-colors:in-data-[selected=true]:text-[HighlightText]",
                          item.note ? "ms-2" : "ms-auto",
                        )}
                      >
                        {item.hint}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div
          data-slash-footer=""
          className="flex shrink-0 items-center gap-2 border-t px-2 py-1 text-xs text-muted-foreground"
        >
          {coarse ? null : (
            <span data-slash-tip="" className="min-w-0 truncate">
              {tip}
            </span>
          )}
          <button
            type="button"
            // Pointer only: keys have Esc, and focus stays in the editor.
            tabIndex={-1}
            className={cn(
              "ms-auto flex shrink-0 items-center gap-1.5 rounded-md hover:bg-accent hover:text-accent-foreground",
              coarse ? "min-h-11 px-3 text-sm" : "min-h-6 px-1.5",
            )}
            onClick={() => dismiss(editor)}
          >
            Close
            {coarse ? null : (
              <kbd className="rounded-sm border px-1 font-mono leading-4">
                esc
              </kbd>
            )}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** For the `+` on an empty line (bubble chunk), through a dynamic import. */
export { markPlusSlash } from "@/lib/slash-menu/plus-origin";
