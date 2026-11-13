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
import { HIGHLIGHT_TOKENS, TEXT_COLOR_TOKENS } from "@/lib/text-style-tokens";
import { cn } from "@/lib/utils";

import { type Swatch, swatchName, swatchStyle } from "./swatch";

/**
 * The colour popover body (spec §4.5): Recent (M3, frozen while open),
 * Text (default + 10) and Highlight (none + 10). Swatches are named
 * `aria-pressed` buttons in a 2-D roving grid, never a radiogroup, so arrow
 * keys move without applying. Lazy chunk: loaded on first open.
 */

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
  /** Called after a swatch applied (the popover closes). */
  onApplied: () => void;
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
  onApplied,
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
  useLayoutEffect(() => {
    focusCell(initial.current.row, initial.current.col);
  }, [focusCell]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { row, col } = active;
    const width = (r: number) => rows[r].swatches.length;
    let next: { row: number; col: number } | null = null;
    switch (event.key) {
      case "ArrowRight":
        next = { row, col: Math.min(col + 1, width(row) - 1) };
        break;
      case "ArrowLeft":
        next = { row, col: Math.max(col - 1, 0) };
        break;
      case "ArrowDown":
        if (row < rows.length - 1)
          next = { row: row + 1, col: Math.min(col, width(row + 1) - 1) };
        break;
      case "ArrowUp":
        if (row > 0)
          next = { row: row - 1, col: Math.min(col, width(row - 1) - 1) };
        break;
      case "Home":
        next = { row, col: 0 };
        break;
      case "End":
        next = { row, col: width(row) - 1 };
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
      data-roving-group=""
      onKeyDown={onKeyDown}
    >
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
              return (
                <button
                  key={`${swatch.kind}-${swatch.token ?? "none"}`}
                  type="button"
                  className={cn("st-swatch", `st-swatch--${swatch.kind}`)}
                  data-row={rowIndex}
                  data-col={colIndex}
                  data-token={swatch.token ?? "none"}
                  aria-label={name}
                  title={name}
                  aria-pressed={pressed}
                  tabIndex={
                    active.row === rowIndex && active.col === colIndex ? 0 : -1
                  }
                  style={swatchStyle(swatch)}
                  onFocus={() => setActive({ row: rowIndex, col: colIndex })}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (applySwatch(editor, swatch)) onApplied();
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
