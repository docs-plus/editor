"use client";

import type { Editor } from "@tiptap/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { announce } from "@/lib/announce";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { BanIcon, CheckIcon } from "@/lib/icons";
import type { RecentColor } from "@/lib/remembered-choice";
import { HIGHLIGHT_TOKENS, TEXT_COLOR_TOKENS } from "@/lib/text-style-tokens";
import { cn } from "@/lib/utils";

import { isCoarsePointer } from "../coarse-pointer";
import { ColorRows } from "./color-rows";
import {
  applySwatch,
  type ColorState,
  LOW_CONTRAST,
  lowContrastNote,
  markPointed,
  swatchTitle,
  useColorState,
} from "./color-state";
import { type Swatch, swatchName, swatchStyle } from "./swatch";
import { useSwatchPreview } from "./swatch-preview";
import "./color-panel.scss";

// The trigger's selection avoidance rides in this chunk (`lazy-surface`).
export { clearOfSelection } from "./clear-of-selection";

export interface ColorPanelProps {
  editor: Editor;
  /** Snapshot of M3 taken when the popover opened. */
  recent: readonly RecentColor[];
  /** Which section takes initial focus. */
  focusKind: "text" | "highlight";
  /**
   * Move focus to the active swatch on mount. False when a tap opened the
   * popover, so the editor keeps focus and the phone keyboard stays up.
   */
  focusOnMount?: boolean;
  /**
   * "rows" (default): the named rows of every desktop surface, the bubble
   * and the row (spec §7.3, O2). "grid": the phone Aa sheet's swatches.
   */
  layout?: "rows" | "grid";
  /** Grid: a line under the swatches naming the current value (§7.3). */
  caption?: "current";
}

/**
 * The colour popover body. Desktop surfaces get the named rows
 * (`color-rows.tsx`); the phone Aa sheet keeps the swatch grid, where a
 * hover name cannot work, so each pick shows a pill naming it with Undo.
 * Lazy chunk: loaded on first open.
 */
export function ColorPanel({ layout = "rows", ...props }: ColorPanelProps) {
  return layout === "rows" ? (
    <ColorRows {...props} />
  ) : (
    <SwatchGrid {...props} />
  );
}

/*
 * The swatch grid (spec §4.5, phone Aa sheet): Recent (M3, frozen while
 * open), Text (default + 10) and Highlight (none + 10). Swatches are named
 * `aria-pressed` buttons in a 2-D roving grid, never a radiogroup, so arrow
 * keys move without applying. ↑/↓ follow the visual lines: on touch each
 * section wraps at `COARSE_COLUMNS` 44px swatches so the popover fits a
 * 360px phone. A kind that cannot apply here keeps its swatches focusable
 * but `aria-disabled`, described by the reason. Applying keeps the popover
 * open with focus on the swatch, so writers can try colours; Esc closes it.
 * Highlight swatches that would put the current text colour below AA
 * (Appendix A, O3) get a dotted border and the description "Low
 * contrast", with one visible line under Highlight naming the text colour
 * (design pass §11), but stay selectable and undimmed. Pointing at a
 * swatch with a mouse, or arrowing to one, previews it on the selection
 * (decorations only, `swatch-preview.ts`); the focus put on a swatch when
 * the popover opens previews nothing. The previewed swatch wears the
 * focus ring: a pointed swatch takes it, and focus elsewhere shows a
 * dashed one until an arrow key hands it back (`markPointed`).
 */

/** Swatches per visual line on touch (6 × 44px + gaps fit 360px). */
const COARSE_COLUMNS = 6;
/** Every section fits one line with a mouse (11 × 24px + gaps). */
const FINE_COLUMNS = 11;

interface Line {
  row: number;
  start: number;
  length: number;
}

/**
 * Swatches per visual line as rendered, so ↑/↓ follow what the user sees:
 * the Aa sheet's grid fills its width (`auto-fill`, design pass §6) and
 * ignores `--swatch-cols`. Falls back to `columns` when the layout is
 * not resolved to pixel tracks.
 */
function renderedColumns(grid: HTMLElement | null, columns: number): number {
  const group = grid?.querySelector(".st-color-swatches");
  const tracks = group
    ? getComputedStyle(group).gridTemplateColumns.split(" ")
    : [];
  return tracks.length > 0 && tracks.every((track) => /^[\d.]+px$/.test(track))
    ? tracks.length
    : columns;
}

/** Each section split into visual lines of at most `columns` swatches. */
function toLines(rows: readonly Row[], columns: number): Line[] {
  return rows.flatMap((row, index) => {
    const lines: Line[] = [];
    for (let start = 0; start < row.swatches.length; start += columns) {
      lines.push({
        row: index,
        start,
        length: Math.min(columns, row.swatches.length - start),
      });
    }
    return lines;
  });
}

interface Row {
  label: string;
  swatches: Swatch[];
}

const TEXT_ROW: Swatch[] = [
  { kind: "text", token: null },
  ...TEXT_COLOR_TOKENS.map((token) => ({ kind: "text" as const, token })),
];
const HIGHLIGHT_ROW: Swatch[] = [
  { kind: "highlight", token: null },
  ...HIGHLIGHT_TOKENS.map((token) => ({ kind: "highlight" as const, token })),
];

/** "Current: Red text, No highlight" (mixed: "mixed text colours"). */
function currentCaption({ current }: ColorState): string {
  const text = current.text;
  const highlight = current.highlight;
  const name = (kind: Swatch["kind"], token: string | null | undefined) =>
    token === undefined
      ? kind === "text"
        ? "mixed text colours"
        : "mixed highlights"
      : swatchName({ kind, token } as Swatch);
  return `Current: ${name("text", text)}, ${name("highlight", highlight)}`;
}

/** Each pick names what it applied, with Undo (phone, §7.3). */
function announcePick(editor: Editor, swatch: Swatch) {
  announce(swatchName(swatch), {
    done: true,
    action: {
      label: "Undo",
      run: () => {
        const undo = editorActions.get("history.undo");
        if (undo) runAction(editor, undo);
      },
    },
  });
}

function SwatchGrid({
  editor,
  recent,
  focusKind,
  focusOnMount = true,
  caption,
}: Omit<ColorPanelProps, "layout">) {
  const state = useColorState(editor);
  const { reasons, isPressed, previewable } = state;
  // M3 is frozen while the popover is open: applying never reshuffles it.
  const [recentRow] = useState<Swatch[]>(() =>
    recent.map((entry) => ({ ...entry }) as Swatch),
  );
  const rows: Row[] = [
    ...(recentRow.length > 0 ? [{ label: "Recent", swatches: recentRow }] : []),
    { label: "Text colour", swatches: TEXT_ROW },
    { label: "Highlight", swatches: HIGHLIGHT_ROW },
  ];

  const [columns] = useState(() =>
    isCoarsePointer() ? COARSE_COLUMNS : FINE_COLUMNS,
  );
  const anyLow = state.anyLow;

  const firstRow = rows.findIndex(
    (row) => row.label === (focusKind === "text" ? "Text colour" : "Highlight"),
  );
  const [active, setActive] = useState(() => {
    const row = rows[firstRow];
    const pressed = row.swatches.findIndex(isPressed);
    return { row: firstRow, col: Math.max(pressed, 0) };
  });

  const gridRef = useRef<HTMLDivElement>(null);
  const idPrefix = useId();
  const preview = useSwatchPreview(editor);
  const focusCell = useCallback((row: number, col: number) => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-row="${row}"][data-col="${col}"]`,
      )
      ?.focus();
  }, []);

  // The chunk may arrive after the popover opened and focused itself:
  // move focus to the active swatch once, on mount.
  const initial = useRef(active);
  const focusInitially = useRef(focusOnMount);
  useLayoutEffect(() => {
    if (focusInitially.current) {
      focusCell(initial.current.row, initial.current.col);
    }
  }, [focusCell]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { row, col } = active;
    const lines = toLines(rows, renderedColumns(gridRef.current, columns));
    const width = rows[row].swatches.length;
    const lineIndex = lines.findIndex(
      (line) =>
        line.row === row && col >= line.start && col < line.start + line.length,
    );
    const onLine = (target: Line | undefined) =>
      target && {
        row: target.row,
        col:
          target.start +
          Math.min(col - lines[lineIndex].start, target.length - 1),
      };
    let next: { row: number; col: number } | undefined;
    switch (event.key) {
      case "ArrowRight":
        next = { row, col: Math.min(col + 1, width - 1) };
        break;
      case "ArrowLeft":
        next = { row, col: Math.max(col - 1, 0) };
        break;
      case "ArrowDown":
        next = onLine(lines[lineIndex + 1]);
        break;
      case "ArrowUp":
        next = onLine(lines[lineIndex - 1]);
        break;
      case "Home":
        next = { row, col: 0 };
        break;
      case "End":
        next = { row, col: width - 1 };
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next) {
      // The keyboard takes over the preview, and with it the ring.
      markPointed(gridRef.current, null);
      setActive(next);
      focusCell(next.row, next.col);
      preview.show(
        previewable(rows[next.row].swatches[next.col]),
        event.repeat,
      );
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys rove the swatch grid; each swatch is a button
    <div
      ref={gridRef}
      className="st-color-panel"
      style={{ "--swatch-cols": columns } as CSSProperties}
      data-roving-group=""
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          preview.clear();
        }
      }}
    >
      {(["text", "highlight"] as const).map((kind) => (
        <span key={kind} hidden>
          {reasons[kind] ? (
            <span id={`${idPrefix}-${kind}-reason`}>{reasons[kind]}</span>
          ) : null}
          {kind === "highlight" ? (
            <span id={`${idPrefix}-${kind}-low`}>{LOW_CONTRAST}</span>
          ) : null}
        </span>
      ))}
      {rows.map((row, rowIndex) => (
        <div key={row.label} className="st-color-row">
          <span
            className="st-color-row-label"
            id={`${idPrefix}-row-${rowIndex}`}
          >
            {row.label}
          </span>
          <div
            role="group"
            aria-labelledby={`${idPrefix}-row-${rowIndex}`}
            className="st-color-swatches"
          >
            {row.swatches.map((swatch, colIndex) => {
              const pressed = isPressed(swatch);
              const name = swatchName(swatch);
              const reason = reasons[swatch.kind];
              const low = state.isLow(swatch);
              const describedBy = [
                reason && `${idPrefix}-${swatch.kind}-reason`,
                low && `${idPrefix}-${swatch.kind}-low`,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={`${swatch.kind}-${swatch.token ?? "none"}`}
                  type="button"
                  className={cn("st-swatch", `st-swatch--${swatch.kind}`)}
                  data-row={rowIndex}
                  data-col={colIndex}
                  data-token={swatch.token ?? "none"}
                  aria-label={name}
                  title={swatchTitle(name, reason, low)}
                  aria-pressed={pressed}
                  aria-disabled={reason ? true : undefined}
                  aria-describedby={describedBy || undefined}
                  data-low-contrast={low ? "" : undefined}
                  tabIndex={
                    active.row === rowIndex && active.col === colIndex ? 0 : -1
                  }
                  style={swatchStyle(swatch)}
                  onFocus={() => setActive({ row: rowIndex, col: colIndex })}
                  onMouseDown={(event) => event.preventDefault()}
                  // A move, not an enter: a swatch the opening sheet slides
                  // under a still mouse gets an enter (and no leave once it
                  // slides on), which would preview a colour nobody chose.
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasAttribute("data-pointed")) {
                      return;
                    }
                    if (event.pointerType !== "touch") {
                      markPointed(gridRef.current, event.currentTarget);
                    }
                    preview.hover(event, previewable(swatch));
                  }}
                  onPointerLeave={(event) => {
                    if (event.currentTarget.hasAttribute("data-pointed")) {
                      markPointed(gridRef.current, null);
                    }
                    preview.leave();
                  }}
                  onClick={() => {
                    // The roving stop follows the pick. Focus moves only
                    // when it is in the grid: a tap-opened popover leaves
                    // it in the editor, so the phone keyboard stays up.
                    setActive({ row: rowIndex, col: colIndex });
                    if (gridRef.current?.contains(document.activeElement)) {
                      focusCell(rowIndex, colIndex);
                    }
                    if (!reason && applySwatch(editor, swatch)) {
                      announcePick(editor, swatch);
                    }
                  }}
                >
                  {swatch.token === null ? (
                    <BanIcon aria-hidden="true" />
                  ) : swatch.kind === "text" ? (
                    <span aria-hidden="true" className="st-swatch-glyph">
                      A
                    </span>
                  ) : null}
                  {pressed ? (
                    <CheckIcon aria-hidden="true" className="st-swatch-check" />
                  ) : null}
                </button>
              );
            })}
          </div>
          {row.label === "Highlight" && anyLow ? (
            <p className="w-0 min-w-full text-xs text-muted-foreground">
              {lowContrastNote(state.current.text)}
            </p>
          ) : null}
        </div>
      ))}
      {caption === "current" ? (
        <p className="st-color-caption">{currentCaption(state)}</p>
      ) : null}
    </div>
  );
}
