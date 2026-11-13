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

import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { BanIcon, CheckIcon } from "@/lib/icons";
import type { RecentColor } from "@/lib/remembered-choice";
import { type ColorTheme, isLowContrastPair } from "@/lib/text-style-contrast";
import {
  HIGHLIGHT_TOKENS,
  isTextColorToken,
  TEXT_COLOR_TOKENS,
} from "@/lib/text-style-tokens";
import { cn } from "@/lib/utils";

import { isCoarsePointer } from "../coarse-pointer";
import { type Swatch, swatchName, swatchStyle } from "./swatch";

/**
 * The colour popover body (spec §4.5): Recent (M3, frozen while open),
 * Text (default + 10) and Highlight (none + 10). Swatches are named
 * `aria-pressed` buttons in a 2-D roving grid, never a radiogroup, so arrow
 * keys move without applying. ↑/↓ follow the visual lines: on touch each
 * section wraps at `COARSE_COLUMNS` 44px swatches so the popover fits a
 * 360px phone. A kind that cannot apply here keeps its swatches focusable
 * but `aria-disabled`, described by the reason. Applying keeps the popover
 * open with focus on the swatch, so writers can try colours; Esc closes it.
 * Highlight swatches that would put the current text colour below AA
 * (Appendix A, O3) are dimmed and described "Low contrast", but stay
 * selectable. Lazy chunk: loaded on first open.
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
}

const TEXT_ROW: Swatch[] = [
  { kind: "text", token: null },
  ...TEXT_COLOR_TOKENS.map((token) => ({ kind: "text" as const, token })),
];
const HIGHLIGHT_ROW: Swatch[] = [
  { kind: "highlight", token: null },
  ...HIGHLIGHT_TOKENS.map((token) => ({ kind: "highlight" as const, token })),
];

const tokenOf = (value: string | null) => value?.toLowerCase() ?? null;

/** The token a view shows; null when none, mixed or not a palette token. */
function paletteToken(value: string | null | undefined) {
  return isTextColorToken(value) ? value : null;
}

/** The theme is a class on <html> (`lib/theme.ts`); this chunk is client-only. */
const currentTheme = (): ColorTheme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

/** O3: true when a highlight swatch would put the current text below AA. */
function isLowContrast(
  swatch: Swatch,
  text: string | null | undefined,
  theme: ColorTheme,
): boolean {
  return (
    swatch.kind === "highlight" &&
    isLowContrastPair(paletteToken(text), swatch.token, theme)
  );
}

/** Tooltip: the disabled reason wins over the low-contrast note. */
function swatchTitle(name: string, reason: string, low: boolean): string {
  if (reason) return `${name}: ${reason}`;
  return low ? `${name}: low contrast` : name;
}

const LOW_CONTRAST = "Low contrast with the current text colour";

function applySwatch(editor: Editor, swatch: Swatch): boolean {
  const id =
    swatch.kind === "text"
      ? swatch.token
        ? "color.text.apply"
        : "color.text.unset"
      : swatch.token
        ? "color.highlight.apply"
        : "color.highlight.unset";
  const action = editorActions.get(id);
  return action ? runAction(editor, action, swatch.token ?? undefined) : false;
}

export function ColorPanel({
  editor,
  recent,
  focusKind,
  focusOnMount = true,
}: ColorPanelProps) {
  const textView = useActionView("color.text.apply", editor);
  const highlightView = useActionView("color.highlight.apply", editor);
  // M3 is frozen while the popover is open: applying never reshuffles it.
  const [recentRow] = useState<Swatch[]>(() =>
    recent.map((entry) => ({ ...entry }) as Swatch),
  );
  const rows: Row[] = [
    ...(recentRow.length > 0 ? [{ label: "Recent", swatches: recentRow }] : []),
    { label: "Text colour", swatches: TEXT_ROW },
    { label: "Highlight", swatches: HIGHLIGHT_ROW },
  ];

  const currentText = textView?.mixed
    ? undefined
    : tokenOf(textView?.value ?? null);
  const currentHighlight = highlightView?.mixed
    ? undefined
    : tokenOf(highlightView?.value ?? null);
  const isPressed = (swatch: Swatch) =>
    (swatch.kind === "text" ? currentText : currentHighlight) === swatch.token;
  const reasons = {
    text: textView && textView.enabled !== true ? textView.enabled.reason : "",
    highlight:
      highlightView && highlightView.enabled !== true
        ? highlightView.enabled.reason
        : "",
  };
  const [columns] = useState(() =>
    isCoarsePointer() ? COARSE_COLUMNS : FINE_COLUMNS,
  );
  const lines = toLines(rows, columns);
  const theme = currentTheme();

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
      setActive(next);
      focusCell(next.row, next.col);
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
              const low = isLowContrast(swatch, currentText, theme);
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
                  onClick={() => {
                    // The roving stop follows the pick. Focus moves only
                    // when it is in the grid: a tap-opened popover leaves
                    // it in the editor, so the phone keyboard stays up.
                    setActive({ row: rowIndex, col: colIndex });
                    if (gridRef.current?.contains(document.activeElement)) {
                      focusCell(rowIndex, colIndex);
                    }
                    if (!reason) applySwatch(editor, swatch);
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
        </div>
      ))}
    </div>
  );
}
