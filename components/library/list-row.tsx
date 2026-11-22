"use client";

/**
 * One row of a list view (UX §8.1: `grid` › `row` › `gridcell`). Rows are
 * absolutely placed by the windowed body (`library-list.tsx`) and memoized,
 * so scrolling and selection re-render only the rows that change.
 */
import { type CSSProperties, memo, type ReactNode } from "react";

import { FileTextIcon, FolderIcon } from "@/lib/icons";
import type { ListRow, Range } from "@/lib/library/list-rows";
import type { LibraryItemRef } from "@/lib/platform/document-index";

import { type RenameExit, RenameField } from "./rename-field";

/** Bold for matched text (never colour alone, UX §8.5). */
export function Highlighted({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly Range[];
}) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const yearFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** A time today, a day this year, else a full date. */
export function formatListDate(time: number | undefined, now: number): string {
  if (time === undefined) return "—";
  const date = new Date(time);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) {
    return timeFormat.format(date);
  }
  return date.getFullYear() === today.getFullYear()
    ? dayFormat.format(date)
    : yearFormat.format(date);
}

export interface ListRowProps {
  row: ListRow;
  /** 1-based, counting the header row (`aria-rowindex`). */
  rowIndex: number;
  style: CSSProperties;
  selected: boolean;
  focused: boolean;
  preview: boolean;
  /** Show the Folder column (lists that span folders). */
  folderColumn: boolean;
  now: number;
  /** The rename field, when this row is being renamed. */
  renaming: boolean;
  onRenameDone: (row: ListRow, next: RenameExit) => void;
}

function refOf(row: ListRow): LibraryItemRef | null {
  if (row.kind === "doc") return { kind: "doc", id: row.id };
  if (row.kind === "folder") return { kind: "folder", id: row.id };
  return null;
}

export const ListRowView = memo(function ListRowView({
  row,
  rowIndex,
  style,
  selected,
  focused,
  preview,
  folderColumn,
  now,
  renaming,
  onRenameDone,
}: ListRowProps) {
  if (row.kind === "group") {
    return (
      <div
        role="row"
        aria-rowindex={rowIndex}
        className="lib-lrow lib-lgroup"
        style={style}
      >
        <div role="rowheader" aria-colspan={folderColumn ? 3 : 2}>
          {row.label}
        </div>
      </div>
    );
  }
  const ref = refOf(row);
  const common = {
    role: "row",
    "aria-rowindex": rowIndex,
    "aria-selected": selected,
    tabIndex: focused ? 0 : -1,
    "data-key": row.key,
    style,
  } as const;

  if (row.kind === "trash") {
    const { item } = row;
    return (
      <div {...common} className="lib-lrow">
        <div role="gridcell" className="lib-lcell lib-lcell-name">
          {item.kind === "folder" ? (
            <FolderIcon aria-hidden="true" />
          ) : (
            <FileTextIcon aria-hidden="true" />
          )}
          <span className="lib-ltitle">
            <bdi dir="auto">
              <Highlighted text={row.label} ranges={row.labelRanges} />
            </bdi>
            {item.kind === "folder" && item.docCount > 0 ? (
              <span className="lib-lmeta">
                {" · "}
                <bdi>
                  {item.docCount}{" "}
                  {item.docCount === 1 ? "document" : "documents"}
                </bdi>
              </span>
            ) : null}
          </span>
        </div>
        <div role="gridcell" className="lib-lcell lib-lcell-folder">
          <bdi dir="auto">{row.location}</bdi>
        </div>
        <div role="gridcell" className="lib-lcell lib-lcell-date">
          <bdi>{formatListDate(item.trashedAt, now)}</bdi>
        </div>
      </div>
    );
  }

  const name =
    renaming && ref ? (
      <RenameField item={ref} onDone={(next) => onRenameDone(row, next)} />
    ) : row.kind === "folder" ? (
      <span className="lib-ltitle">
        <bdi dir="auto">
          <Highlighted text={row.name} ranges={row.nameRanges} />
        </bdi>
      </span>
    ) : (
      <span className="lib-ltitle">
        <bdi dir="auto">
          <Highlighted text={row.title} ranges={row.titleRanges} />
        </bdi>
      </span>
    );

  const tags =
    row.kind === "doc" && row.tags.length > 0 ? (
      <span className="lib-ltags">
        {row.tags.map((tag) => (
          <span key={tag.id} className="lib-tag-chip">
            <bdi dir="auto">{tag.name}</bdi>
          </span>
        ))}
      </span>
    ) : null;

  return (
    <div
      {...common}
      className="lib-lrow"
      data-preview={preview ? "" : undefined}
    >
      <div role="gridcell" className="lib-lcell lib-lcell-name">
        {row.kind === "folder" ? (
          <FolderIcon aria-hidden="true" />
        ) : (
          <FileTextIcon aria-hidden="true" />
        )}
        {preview && row.kind === "doc" ? (
          <span className="lib-lstack">
            <span className="lib-lline">
              {name}
              {tags}
            </span>
            <span className="lib-lsnippet">
              <bdi dir="auto">{row.entry.snippet ?? ""}</bdi>
            </span>
          </span>
        ) : (
          <>
            {name}
            {tags}
          </>
        )}
      </div>
      {folderColumn ? (
        <div role="gridcell" className="lib-lcell lib-lcell-folder">
          {row.kind === "doc" ? (
            <bdi dir="auto">
              {row.path.length > 0 ? row.path.join(" › ") : "Library"}
            </bdi>
          ) : null}
        </div>
      ) : null}
      <div role="gridcell" className="lib-lcell lib-lcell-date">
        {row.kind === "doc" ? <bdi>{formatListDate(row.date, now)}</bdi> : null}
      </div>
    </div>
  );
});
