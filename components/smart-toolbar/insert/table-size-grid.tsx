"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { MAX_TABLE_SIZE, type TableSize } from "@/lib/remembered-choice";

import { isCoarsePointer } from "../coarse-pointer";

export interface TableSizeGridProps {
  /** Opens here (M17a: the last size). */
  initial: TableSize;
  onPick: (size: TableSize) => void;
}

/** Largest grid on touch: 6 × 44px cells plus gaps fit a 360px phone. */
export const COARSE_MAX_TABLE_SIZE = 6;

/**
 * Rows × columns picker for Insert → Table. One focusable cell (roving):
 * arrow keys grow or shrink the size and move focus, Enter or a click
 * inserts. Hovering only previews the size; focus stays put. The focused
 * cell's name ("3 by 4 table") is the announcement, so the visible caption
 * is not a live region.
 */
export function TableSizeGrid({ initial, onPick }: TableSizeGridProps) {
  const [max] = useState(() =>
    isCoarsePointer() ? COARSE_MAX_TABLE_SIZE : MAX_TABLE_SIZE,
  );
  const clamp = (value: number) => Math.min(Math.max(value, 1), max);
  const [size, setSize] = useState<TableSize>(() => ({
    rows: clamp(initial.rows),
    cols: clamp(initial.cols),
  }));
  const gridRef = useRef<HTMLDivElement>(null);

  const focusCell = (target: TableSize) =>
    gridRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-row="${target.rows}"][data-col="${target.cols}"]`,
      )
      ?.focus();

  // Focus the opening cell once; later, only keyboard moves focus.
  const opening = useRef(size);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only
  useLayoutEffect(() => {
    focusCell(opening.current);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, TableSize> = {
      ArrowRight: { rows: size.rows, cols: clamp(size.cols + 1) },
      ArrowLeft: { rows: size.rows, cols: clamp(size.cols - 1) },
      ArrowDown: { rows: clamp(size.rows + 1), cols: size.cols },
      ArrowUp: { rows: clamp(size.rows - 1), cols: size.cols },
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    setSize(next);
    focusCell(next);
  };

  const cells = [];
  for (let row = 1; row <= max; row++) {
    for (let col = 1; col <= max; col++) {
      const active = row === size.rows && col === size.cols;
      cells.push(
        <button
          key={`${row}-${col}`}
          type="button"
          className="st-table-cell"
          data-row={row}
          data-col={col}
          data-in-range={row <= size.rows && col <= size.cols}
          aria-label={`${row} by ${col} table`}
          tabIndex={active ? 0 : -1}
          onPointerEnter={() => setSize({ rows: row, cols: col })}
          onClick={() => onPick({ rows: row, cols: col })}
        />,
      );
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={gridRef}
        role="group"
        aria-label="Table size"
        className="st-table-grid"
        style={{ "--cols": max } as CSSProperties}
        data-roving-group=""
        onKeyDown={onKeyDown}
      >
        {cells}
      </div>
      <p className="st-table-size" aria-hidden="true">
        {size.rows} × {size.cols}
      </p>
    </div>
  );
}
