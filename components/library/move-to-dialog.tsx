"use client";

/**
 * Move to… (UX §5.4, details spec §6.1): the keyboard alternative to drag
 * and drop. A folder filter, the last three destinations first, then every
 * folder as an APG tree. Destinations that would be refused stay listed,
 * disabled, with the reason. Enter on a folder moves there. New Folder
 * makes one inside the selected folder.
 */
import { Fragment, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FolderIcon,
  FolderPlusIcon,
  LibraryIcon,
  SearchIcon,
} from "@/lib/icons";
import {
  canCreateFolderIn,
  checkMove,
  type FolderIndex,
  folderPath,
  indexFolders,
  moveRefusalMessage,
} from "@/lib/library/folder-rules";
import { entryTitle, nameCollator } from "@/lib/library/tree-rows";
import type {
  LibraryIndexSnapshot,
  LibraryItemRef,
} from "@/lib/platform/document-index";
import { normalizeSearchText } from "@/lib/search/normalize";

import { useLibrary } from "./library-context";

interface DestinationRow {
  /** Null is the Library root. */
  id: string | null;
  name: string;
  level: number;
}

/** Why a destination can't take the items, or null. */
function refusalFor(
  folders: FolderIndex,
  snapshot: LibraryIndexSnapshot,
  items: readonly LibraryItemRef[],
  id: string | null,
): { short: string; long: string } | null {
  const here = items.every((item) =>
    item.kind === "doc"
      ? (snapshot.items.find((doc) => doc.id === item.id)?.folderId ?? null) ===
        id
      : folders.byId.get(item.id)?.parentId === id,
  );
  if (here)
    return { short: "Current folder", long: "This is where it is now." };
  const reason = checkMove(folders, items, id);
  return reason ? { short: "", long: moveRefusalMessage(reason) } : null;
}

function destinationRows(folders: FolderIndex): DestinationRow[] {
  const rows: DestinationRow[] = [{ id: null, name: "Library", level: 1 }];
  const walk = (parent: string | null, level: number) => {
    const children = [...(folders.children.get(parent) ?? [])].sort((a, b) =>
      nameCollator.compare(a.name, b.name),
    );
    for (const folder of children) {
      rows.push({ id: folder.id, name: folder.name, level });
      walk(folder.id, level + 1);
    }
  };
  walk(null, 2);
  return rows;
}

export function MoveToDialog({
  items,
  onClose,
}: {
  items: readonly LibraryItemRef[];
  onClose: (moved: boolean) => void;
}) {
  const { index, snapshot, actions, recentDestinations } = useLibrary();
  const folders = useMemo(() => indexFolders(snapshot.folders), [snapshot]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null | undefined>(
    undefined,
  );
  const [focused, setFocused] = useState<string | null | undefined>(undefined);
  const [naming, setNaming] = useState<{ parent: string | null } | null>(null);
  const [newName, setNewName] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const treeId = useId();
  const recentId = useId();
  const hintId = useId();

  const title =
    items.length === 1
      ? `Move “${
          items[0].kind === "folder"
            ? (folders.byId.get(items[0].id)?.name ?? "")
            : entryTitle(
                snapshot.items.find((doc) => doc.id === items[0].id) ?? {
                  title: "",
                },
              )
        }”`
      : `Move ${items.length} items`;

  const allRows = useMemo(() => destinationRows(folders), [folders]);
  const rows = useMemo(() => {
    const query = normalizeSearchText(filter.trim());
    if (!query) return allRows;
    const keep = new Set<string | null>();
    for (const row of allRows) {
      if (row.id && normalizeSearchText(row.name).includes(query)) {
        for (const folder of folderPath(folders, row.id)) keep.add(folder.id);
        keep.add(null);
      }
    }
    return allRows.filter((row) => keep.has(row.id));
  }, [allRows, filter, folders]);

  const refusals = useMemo(
    () =>
      new Map(
        allRows.map((row) => [
          row.id,
          refusalFor(folders, snapshot, items, row.id),
        ]),
      ),
    [allRows, folders, snapshot, items],
  );
  const recent = recentDestinations.filter(
    (id) => id === null || folders.byId.has(id),
  );

  const firstAllowed = rows.find((row) => !refusals.get(row.id))?.id ?? null;
  const tabStop =
    focused !== undefined && rows.some((row) => row.id === focused)
      ? focused
      : firstAllowed;
  const canMove = selected !== undefined && !refusals.get(selected);

  const focusRow = (id: string | null) => {
    setFocused(id);
    if (!refusals.get(id)) setSelected(id);
    const element = () =>
      treeRef.current?.querySelector<HTMLElement>(`[data-dest="${id ?? ""}"]`);
    // Rendered rows take focus at once, so a fast second key lands in the
    // tree; a folder made just now takes it after it renders.
    const now = element();
    if (now) now.focus();
    else requestAnimationFrame(() => element()?.focus());
  };

  const moveTo = (id: string | null) => {
    if (refusals.get(id)) return;
    if (actions.move(items, id)) onClose(true);
  };

  const commitNewFolder = () => {
    const name = newName.trim();
    if (!naming || !name) {
      setNaming(null);
      return;
    }
    const folder = index.createFolder({ name, parentId: naming.parent });
    setNaming(null);
    setNewName("");
    if (folder) {
      // The snapshot updates synchronously; select it once it renders.
      setSelected(folder.id);
      focusRow(folder.id);
    }
  };

  const startNewFolder = () => {
    const parent = selected ?? focused ?? null;
    if (!canCreateFolderIn(folders, parent)) {
      setNaming(null);
      return;
    }
    setFilter("");
    setNewName("New Folder");
    setNaming({ parent });
  };

  const focusedRefusal =
    tabStop !== undefined ? refusals.get(tabStop ?? null) : null;
  const newFolderAllowed = canCreateFolderIn(
    folders,
    selected ?? focused ?? null,
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose(false);
      }}
    >
      <DialogContent
        className="lib-dialog lib-move-dialog"
        showCloseButton={false}
        initialFocus={filterRef}
      >
        <DialogTitle>
          <bdi dir="auto">{title}</bdi>
        </DialogTitle>
        <label className="lib-filter">
          <SearchIcon aria-hidden="true" />
          <input
            ref={filterRef}
            type="text"
            value={filter}
            placeholder="Filter folders"
            aria-label="Filter folders"
            aria-controls={treeId}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (tabStop !== undefined) focusRow(tabStop);
              }
            }}
          />
        </label>
        {recent.length > 0 && !filter ? (
          <div
            className="lib-recent-dest"
            role="group"
            aria-labelledby={recentId}
          >
            <p id={recentId} className="lib-section-label">
              Recent destinations
            </p>
            {recent.map((id) => {
              const refusal = refusals.get(id);
              const path = folderPath(folders, id).map((f) => f.name);
              return (
                <Button
                  key={id ?? "root"}
                  variant="ghost"
                  size="sm"
                  className="lib-recent-dest-button"
                  aria-disabled={refusal ? true : undefined}
                  title={refusal?.long}
                  onClick={() => moveTo(id)}
                >
                  {id ? (
                    <FolderIcon aria-hidden="true" />
                  ) : (
                    <LibraryIcon aria-hidden="true" />
                  )}
                  <bdi dir="auto">{id ? path.join(" › ") : "Library"}</bdi>
                </Button>
              );
            })}
          </div>
        ) : null}
        <div
          ref={treeRef}
          id={treeId}
          role="tree"
          aria-label="Folders"
          aria-describedby={focusedRefusal ? hintId : undefined}
          className="lib-dest-tree"
          onKeyDown={(event) => {
            if ((event.target as HTMLElement).closest("input")) return;
            const at = rows.findIndex((row) => row.id === tabStop);
            const go = (to: number) => {
              const row = rows[Math.min(Math.max(to, 0), rows.length - 1)];
              if (row) focusRow(row.id);
            };
            switch (event.key) {
              case "ArrowDown":
                event.preventDefault();
                go(at + 1);
                break;
              case "ArrowUp":
                event.preventDefault();
                go(at - 1);
                break;
              case "Home":
                event.preventDefault();
                go(0);
                break;
              case "End":
                event.preventDefault();
                go(rows.length - 1);
                break;
              case "Enter":
                event.preventDefault();
                if (tabStop !== undefined) moveTo(tabStop);
                break;
            }
          }}
        >
          {rows.length === 0 ? (
            <p className="lib-muted lib-dest-empty">No folders match.</p>
          ) : null}
          {rows.map((row) => {
            const refusal = refusals.get(row.id);
            const isNamingHere = naming && naming.parent === row.id;
            return (
              <Fragment key={row.id ?? "root"}>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: the tree's onKeyDown handles keys */}
                <div
                  role="treeitem"
                  aria-level={row.level}
                  aria-selected={selected === row.id}
                  aria-disabled={refusal ? true : undefined}
                  tabIndex={row.id === tabStop ? 0 : -1}
                  data-dest={row.id ?? ""}
                  className="lib-dest"
                  style={{ "--lib-level": row.level } as React.CSSProperties}
                  title={refusal?.long}
                  onClick={() => focusRow(row.id)}
                  onDoubleClick={() => moveTo(row.id)}
                  onFocus={() => setFocused(row.id)}
                >
                  {row.id ? (
                    <FolderIcon aria-hidden="true" />
                  ) : (
                    <LibraryIcon aria-hidden="true" />
                  )}
                  <span className="lib-label">
                    <bdi dir="auto">{row.name}</bdi>
                  </span>
                  {refusal?.short ? (
                    <span className="lib-muted lib-dest-note">
                      {refusal.short}
                    </span>
                  ) : null}
                </div>
                {isNamingHere ? (
                  <div
                    className="lib-dest lib-dest-new"
                    style={
                      { "--lib-level": row.level + 1 } as React.CSSProperties
                    }
                  >
                    <FolderIcon aria-hidden="true" />
                    <input
                      autoFocus
                      className="lib-rename-input"
                      aria-label="New folder name"
                      value={newName}
                      maxLength={200}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => setNewName(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitNewFolder();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setNaming(null);
                          focusRow(row.id);
                        }
                      }}
                      onBlur={commitNewFolder}
                    />
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
        <p id={hintId} className="lib-muted lib-dest-hint" aria-live="polite">
          {focusedRefusal?.long ?? ""}
        </p>
        <DialogFooter className="lib-dialog-footer">
          <Button
            variant="outline"
            className="lib-footer-start"
            onClick={startNewFolder}
            aria-disabled={newFolderAllowed ? undefined : true}
            title={
              newFolderAllowed ? undefined : moveRefusalMessage("too_deep")
            }
          >
            <FolderPlusIcon aria-hidden="true" />
            New Folder
          </Button>
          <Button variant="outline" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => selected !== undefined && moveTo(selected)}
            disabled={!canMove}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
