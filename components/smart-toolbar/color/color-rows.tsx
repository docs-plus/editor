"use client";

import type { Editor } from "@tiptap/react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { colorLabel } from "@/lib/editor-actions/surface-actions";
import { BanIcon, CheckIcon } from "@/lib/icons";
import type { RecentColor } from "@/lib/remembered-choice";
import { cn } from "@/lib/utils";

import {
  FIRST_HIGHLIGHTS,
  FIRST_TEXT_COLORS,
  MORE_HIGHLIGHTS,
  MORE_TEXT_COLORS,
  moreStep,
  type RowsPos,
  rowsStep,
  typeahead,
} from "./color-order";
import {
  announcePick,
  applySwatch,
  type ColorState,
  LOW_CONTRAST,
  lowContrastNote,
  markPointed,
  swatchTitle,
  useColorState,
} from "./color-state";
import { type Swatch, swatchName, swatchStyle } from "./swatch";
import { type SwatchPreview, useSwatchPreview } from "./swatch-preview";

/**
 * The named colour rows of every desktop surface, the bubble and the row
 * (spec §7.3, O2): Recent first (M3, up to five chips, frozen while
 * open), then two columns side by side, Text | Highlight, each Default /
 * No highlight plus its curated colours (`color-order.ts`) and a "More ▸"
 * submenu with the rest. The rows are `menuitemradio` in two `group`s of
 * one `menu`; ✓ marks the current value, and a mixed selection checks
 * nothing and shows "–" on the column label. Arrow keys follow
 * `rowsStep`: ↑/↓ within a column, ←/→ across in visual order, the
 * inline-end arrow on "More" opens it. Pointing at a row with a mouse,
 * or arrowing to one, previews it on the selection (`swatch-preview.ts`);
 * the focus put on a row when the menu opens previews nothing. A kind
 * that cannot apply keeps its rows focusable but `aria-disabled`,
 * described by the reason; highlights below AA on the current text get a
 * dotted chip and the note under Highlight (O3). Applying keeps the menu
 * open, so writers can try colours; Esc closes it.
 */

type Kind = Swatch["kind"];

const swatchesOf = (kind: Kind, tokens: readonly (string | null)[]) =>
  tokens.map((token) => ({ kind, token }) as Swatch);

/** Each column's rows before "More": the default, then the curated ones. */
const COLUMN: Record<Kind, Swatch[]> = {
  text: swatchesOf("text", [null, ...FIRST_TEXT_COLORS]),
  highlight: swatchesOf("highlight", [null, ...FIRST_HIGHLIGHTS]),
};
const MORE: Record<Kind, Swatch[]> = {
  text: swatchesOf("text", MORE_TEXT_COLORS),
  highlight: swatchesOf("highlight", MORE_HIGHLIGHTS),
};
const COPY = {
  text: { label: "Text", more: "More colours", none: "Default" },
  highlight: {
    label: "Highlight",
    more: "More highlights",
    none: "No highlight",
  },
} as const;

/** The visible row name ("Teal"); the accessible name is `swatchName`. */
const rowLabel = (swatch: Swatch) =>
  swatch.token ? colorLabel(swatch.token) : COPY[swatch.kind].none;

const isRtl = (el: Element) => getComputedStyle(el).direction === "rtl";

/**
 * Closes a menu exactly as Esc pressed in it would (Base UI's dismiss
 * listens on the document). The popover belongs to the eager trigger
 * (`color-controls.tsx`), so this chunk has no handle on its state. Focus
 * is already back in the editor, so Base UI does not return it to the
 * trigger.
 */
function closeMenu(menu: Element | null): void {
  menu?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** A plain letter or digit typed into a menu: typeahead, not a shortcut. */
const isTypeahead = (event: KeyboardEvent) =>
  !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1;

/**
 * Typeahead over a menu's items (spec §7.10): the next item after the
 * focused one whose visible name starts with `key` (a Recent chip's
 * accessible name), or null.
 */
function typeaheadItem(
  container: HTMLElement | null,
  key: string,
): HTMLElement | null {
  const items = [
    ...(container?.querySelectorAll<HTMLElement>(".st-color-item") ?? []),
  ];
  const labels = items.map(
    (item) =>
      item.querySelector(".st-color-item-label")?.textContent ??
      item.getAttribute("aria-label") ??
      "",
  );
  const at = typeahead(
    labels,
    items.indexOf(document.activeElement as HTMLElement),
    key,
  );
  return at === null ? null : items[at];
}

/** Where the roving stop starts: the asked column's checked row (or More). */
function initialPos(kind: Kind, state: ColorState): RowsPos {
  const shown = COLUMN[kind].findIndex(state.isPressed);
  if (shown >= 0) return { section: kind, index: shown };
  const inMore = MORE[kind].some(state.isPressed);
  return { section: kind, index: inMore ? COLUMN[kind].length : 0 };
}

/** The 18px tile: an "A" in the colour, or on the highlight; ⊘ for none. */
function Chip({ swatch, low }: { swatch: Swatch; low: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("st-color-chip", `st-color-chip--${swatch.kind}`)}
      data-low-contrast={low ? "" : undefined}
      style={swatchStyle(swatch)}
    >
      {swatch.token === null ? <BanIcon /> : "A"}
    </span>
  );
}

interface PickProps {
  swatch: Swatch;
  state: ColorState;
  preview: SwatchPreview;
  /** Reason and low-contrast description ids. */
  idPrefix: string;
  /** The container whose pointed row wears the ring (`markPointed`). */
  container: () => HTMLElement | null;
  onPick: (swatch: Swatch) => void;
  role: "menuitemradio" | "menuitem";
  className: string;
  tabIndex: number;
  data: { section: string; index: number };
  onFocus?: () => void;
  children: ReactNode;
}

/** One colour item: a named row, a Recent chip or a More row. */
function Pick({
  swatch,
  state,
  preview,
  idPrefix,
  container,
  onPick,
  role,
  className,
  tabIndex,
  data,
  onFocus,
  children,
}: PickProps) {
  const name = swatchName(swatch);
  const reason = state.reasons[swatch.kind];
  const low = state.isLow(swatch);
  const describedBy = [
    reason && `${idPrefix}-${swatch.kind}-reason`,
    low && `${idPrefix}-low`,
  ]
    .filter(Boolean)
    .join(" ");
  // Recent chips are plain items: the radio state lives in the columns.
  const radio =
    role === "menuitemradio"
      ? { "aria-checked": state.isPressed(swatch) }
      : undefined;
  return (
    <button
      type="button"
      role={role}
      className={cn("st-color-item", className)}
      data-section={data.section}
      data-index={data.index}
      data-token={swatch.token ?? "none"}
      aria-label={name}
      title={swatchTitle(name, reason, low)}
      {...radio}
      aria-disabled={reason ? true : undefined}
      aria-describedby={describedBy || undefined}
      data-low-contrast={low ? "" : undefined}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onMouseDown={(event) => event.preventDefault()}
      // A move, not an enter: a row the opening menu slides under a still
      // mouse gets an enter (and no leave once it slides on), which would
      // preview a colour nobody chose.
      onPointerMove={(event: PointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasAttribute("data-pointed")) return;
        if (event.pointerType !== "touch") {
          markPointed(container(), event.currentTarget);
        }
        preview.hover(event, state.previewable(swatch));
      }}
      onPointerLeave={(event) => {
        if (event.currentTarget.hasAttribute("data-pointed")) {
          markPointed(container(), null);
        }
        preview.leave();
      }}
      onClick={() => {
        if (!reason) onPick(swatch);
      }}
    >
      {children}
    </button>
  );
}

interface MoreProps {
  kind: Kind;
  /** The menu's direction: the submenu opens on its inline-end side. */
  rtl: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ColorState;
  preview: SwatchPreview;
  idPrefix: string;
  onPick: (swatch: Swatch) => void;
  tabIndex: number;
  index: number;
  onFocus: () => void;
}

/** "More colours ▸": a side submenu with the rest, in token order. */
function MoreRow({
  kind,
  rtl,
  open,
  onOpenChange,
  state,
  preview,
  idPrefix,
  onPick,
  tabIndex,
  index,
  onFocus,
}: MoreProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const swatches = MORE[kind];
  const checked = swatches.findIndex(state.isPressed);
  const items = () => [
    ...(popupRef.current?.querySelectorAll<HTMLElement>(".st-color-item") ??
      []),
  ];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const typed = isTypeahead(event)
      ? typeaheadItem(popupRef.current, event.key)
      : null;
    const at = list.indexOf(event.target as HTMLElement);
    const next = typed
      ? list.indexOf(typed)
      : moreStep(at, event.key, rtl, list.length);
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (next === "close") {
      onOpenChange(false);
    } else if (next !== null) {
      markPointed(popupRef.current, null);
      list[next]?.focus();
      preview.show(state.previewable(swatches[next]), event.repeat);
    }
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            className="st-color-item st-color-more"
            data-section={kind}
            data-index={index}
            tabIndex={tabIndex}
            onFocus={onFocus}
            onMouseDown={(event) => event.preventDefault()}
          />
        }
      >
        <span className="st-color-item-label">{COPY[kind].more}</span>
        {checked >= 0 ? (
          <CheckIcon aria-hidden="true" className="st-color-check" />
        ) : null}
        {/* A CSS chevron: an icon import shared with the editor chunk
            would add a re-export to it (`color-panel.scss`). */}
        <span aria-hidden="true" className="st-color-more-icon" />
      </PopoverTrigger>
      <PopoverContent
        ref={popupRef}
        role="menu"
        aria-label={COPY[kind].more}
        // Physical, not "inline-end": Base UI reads its own direction
        // provider, which the app does not set, not the document's `dir`.
        side={rtl ? "left" : "right"}
        align="start"
        className="st-color-more-popup"
        initialFocus={() =>
          popupRef.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? true
        }
        onKeyDown={onKeyDown}
      >
        {swatches.map((swatch, at) => (
          <Pick
            key={swatch.token}
            swatch={swatch}
            state={state}
            preview={preview}
            idPrefix={idPrefix}
            container={() => popupRef.current}
            onPick={onPick}
            role="menuitemradio"
            className="st-color-named"
            tabIndex={at === Math.max(checked, 0) ? 0 : -1}
            data={{ section: `more-${kind}`, index: at }}
          >
            <RowBody swatch={swatch} state={state} />
          </Pick>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function RowBody({ swatch, state }: { swatch: Swatch; state: ColorState }) {
  return (
    <>
      <Chip swatch={swatch} low={state.isLow(swatch)} />
      <span className="st-color-item-label">{rowLabel(swatch)}</span>
      {state.isPressed(swatch) ? (
        <CheckIcon aria-hidden="true" className="st-color-check" />
      ) : null}
    </>
  );
}

export function ColorRows({
  editor,
  recent,
  focusKind,
  focusOnMount = true,
}: {
  editor: Editor;
  recent: readonly RecentColor[];
  focusKind: Kind;
  focusOnMount?: boolean;
}) {
  const state = useColorState(editor);
  // M3 is frozen while the menu is open: applying never reshuffles it.
  // It keeps at most five (`MAX_RECENT_COLORS`), so all of them show.
  const [recentRow] = useState<Swatch[]>(() =>
    recent.map((entry) => ({ ...entry }) as Swatch),
  );
  const [active, setActive] = useState(() => initialPos(focusKind, state));
  const [openMore, setOpenMore] = useState<Kind | null>(null);
  const [rtl, setRtl] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const idPrefix = useId();
  const preview = useSwatchPreview(editor);
  const sizes = {
    recent: recentRow.length,
    text: COLUMN.text.length + 1,
    highlight: COLUMN.highlight.length + 1,
  };
  /** The swatch at a position; null for a "More" row. */
  const swatchAt = ({ section, index }: RowsPos): Swatch | null =>
    (section === "recent" ? recentRow : COLUMN[section])[index] ?? null;

  const focusAt = useCallback(({ section, index }: RowsPos) => {
    panelRef.current
      ?.querySelector<HTMLElement>(
        `[data-section="${section}"][data-index="${index}"]`,
      )
      ?.focus();
  }, []);

  // The chunk may arrive after the popover opened and focused itself:
  // move focus to the active row once, on mount.
  const initial = useRef(active);
  const focusInitially = useRef(focusOnMount);
  useLayoutEffect(() => {
    if (focusInitially.current) focusAt(initial.current);
  }, [focusAt]);
  // The interface direction, read once: it does not change while open.
  useLayoutEffect(() => {
    if (panelRef.current) setRtl(isRtl(panelRef.current));
  }, []);

  /** An item's place in the rows, from its `data-section`/`data-index`. */
  const posOf = (item: HTMLElement): RowsPos => ({
    section: item.dataset.section as RowsPos["section"],
    index: Number(item.dataset.index),
  });

  /**
   * A pick applies, names the colour in the live region (and the pill,
   * with Undo), and closes every menu: focus returns to the editor with
   * the selection, which closes the popovers (spec §7.10).
   */
  const pick = (swatch: Swatch) => {
    if (!applySwatch(editor, swatch)) return;
    editor.commands.focus();
    const done = () => {
      closeMenu(panelRef.current);
      // After closing: the Esc that closes the menu also dismisses the pill.
      announcePick(editor, swatch);
    };
    if (openMore === null) {
      done();
    } else {
      // An open submenu blocks the menu's Esc until it has closed.
      setOpenMore(null);
      requestAnimationFrame(done);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys from a More submenu bubble here through its portal.
    if (!event.currentTarget.contains(event.target as Node)) return;
    const typed = isTypeahead(event)
      ? typeaheadItem(panelRef.current, event.key)
      : null;
    const next = typed ? posOf(typed) : rowsStep(active, event.key, rtl, sizes);
    if (next === undefined) return;
    event.preventDefault();
    if (next === "open-more") {
      setOpenMore(active.section === "highlight" ? "highlight" : "text");
      return;
    }
    if (!next) return;
    // The keyboard takes over the preview, and with it the ring.
    markPointed(panelRef.current, null);
    setActive(next);
    focusAt(next);
    const swatch = swatchAt(next);
    preview.show(swatch && state.previewable(swatch), event.repeat);
  };

  const common = {
    state,
    preview,
    idPrefix,
    container: () => panelRef.current,
    onPick: pick,
  };
  const stop = (pos: RowsPos) =>
    active.section === pos.section && active.index === pos.index ? 0 : -1;

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label="Colours"
      className="st-color-panel st-color-rows"
      data-roving-group=""
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        const to = event.relatedTarget;
        if (
          !(
            to instanceof Element &&
            to.closest(".st-color-rows, .st-color-more-popup")
          )
        ) {
          preview.clear();
        }
      }}
    >
      <span hidden>
        {(["text", "highlight"] as const).map((kind) =>
          state.reasons[kind] ? (
            <span key={kind} id={`${idPrefix}-${kind}-reason`}>
              {state.reasons[kind]}
            </span>
          ) : null,
        )}
        <span id={`${idPrefix}-low`}>{LOW_CONTRAST}</span>
      </span>
      {recentRow.length > 0 ? (
        <div
          role="group"
          aria-labelledby={`${idPrefix}-recent`}
          className="st-color-recent"
        >
          <span id={`${idPrefix}-recent`} className="st-color-row-label">
            Recent
          </span>
          <div className="st-color-recent-chips">
            {recentRow.map((swatch, index) => (
              <Pick
                // Recent can repeat a kind and token only once (M3).
                key={`${swatch.kind}-${swatch.token ?? "none"}`}
                {...common}
                swatch={swatch}
                role="menuitem"
                className="st-color-recent-chip"
                tabIndex={stop({ section: "recent", index })}
                data={{ section: "recent", index }}
                onFocus={() => setActive({ section: "recent", index })}
              >
                <Chip swatch={swatch} low={state.isLow(swatch)} />
              </Pick>
            ))}
          </div>
        </div>
      ) : null}
      <div className="st-color-columns">
        {(["text", "highlight"] as const).map((kind) => (
          <div
            key={kind}
            role="group"
            aria-labelledby={`${idPrefix}-${kind}`}
            className="st-color-column"
            data-color-kind={kind}
          >
            <span id={`${idPrefix}-${kind}`} className="st-color-row-label">
              {COPY[kind].label}
              {state.current[kind] === undefined ? (
                <span aria-hidden="true" title="Mixed">
                  {" –"}
                </span>
              ) : null}
            </span>
            {COLUMN[kind].map((swatch, index) => (
              <Pick
                key={swatch.token ?? "none"}
                {...common}
                swatch={swatch}
                role="menuitemradio"
                className="st-color-named"
                tabIndex={stop({ section: kind, index })}
                data={{ section: kind, index }}
                onFocus={() => setActive({ section: kind, index })}
              >
                <RowBody swatch={swatch} state={state} />
              </Pick>
            ))}
            <MoreRow
              kind={kind}
              rtl={rtl}
              open={openMore === kind}
              onOpenChange={(open) => setOpenMore(open ? kind : null)}
              state={state}
              preview={preview}
              idPrefix={idPrefix}
              onPick={pick}
              index={COLUMN[kind].length}
              tabIndex={stop({ section: kind, index: COLUMN[kind].length })}
              onFocus={() =>
                setActive({ section: kind, index: COLUMN[kind].length })
              }
            />
            {kind === "highlight" && state.anyLow ? (
              <p className="st-color-note">
                {lowContrastNote(state.current.text)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
