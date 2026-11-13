"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { MAX_TABLE_SIZE, type TableSize } from "@/lib/remembered-choice";

export interface TableSizeGridProps {
  /** Opens here (M17a: the last size). */
  initial: TableSize;
  onPick: (size: TableSize) => void;
}

const clamp = (value: number) => Math.min(Math.max(value, 1), MAX_TABLE_SIZE);

/**
 * Rows × columns picker for Insert → Table. One focusable cell (roving):
 * arrow keys grow or shrink the size, Enter or a click inserts. Hovering
 * previews the size.
 */
export function TableSizeGrid({ initial, onPick }: TableSizeGridProps) {
  const [size, setSize] = useState<TableSize>({
    rows: clamp(initial.rows),
    cols: clamp(initial.cols),
  });
  const gridRef = useRef<HTMLDivElement>(null);

  // Focus follows the active cell (also on open).
  useEffect(() => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-row="${size.rows}"][data-col="${size.cols}"]`,
      )
      ?.focus();
  }, [size]);

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
  };

  const cells = [];
  for (let row = 1; row <= MAX_TABLE_SIZE; row++) {
    for (let col = 1; col <= MAX_TABLE_SIZE; col++) {
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move the roving cell; each cell is a button */}
      <div
        ref={gridRef}
        role="group"
        aria-label="Table size"
        className="st-table-grid"
        style={{ "--cols": MAX_TABLE_SIZE } as CSSProperties}
        data-roving-group=""
        onKeyDown={onKeyDown}
      >
        {cells}
      </div>
      <p className="st-table-size" aria-live="polite">
        {size.rows} × {size.cols}
      </p>
    </div>
  );
}
