/**
 * Where a dragged set of documents and folders may land (details spec
 * §6.1), shared by the files sidebar's drag and drop and its tests. The
 * same `checkMove` rule backs Move to… and the index itself.
 */
import { checkMove, indexFolders } from "@/lib/library/folder-rules";
import type {
  LibraryIndexSnapshot,
  LibraryItemRef,
} from "@/lib/platform/document-index";

export type DropTarget =
  | { kind: "folder"; id: string }
  | { kind: "root" }
  | { kind: "pinned" }
  | { kind: "trash" }
  | { kind: "pin"; id: string };

export interface DragPayload {
  items: LibraryItemRef[];
  label: string;
  /** Dragged from the Pinned list (it can only reorder there). */
  fromPinned?: boolean;
}

export function dropTargetId(target: DropTarget): string {
  return "id" in target
    ? `drop-${target.kind}:${target.id}`
    : `drop-${target.kind}`;
}

/**
 * Whether `payload` may land on `target`: `ok`, `refused` (a folder into
 * itself, or too deep), or `noop` (everything is already there, or the
 * target doesn't take it).
 */
export function dropVerdict(
  snapshot: LibraryIndexSnapshot,
  payload: DragPayload,
  target: DropTarget,
): "ok" | "refused" | "noop" {
  const { items } = payload;
  switch (target.kind) {
    case "folder":
    case "root": {
      if (payload.fromPinned) return "noop";
      const folderId = target.kind === "folder" ? target.id : null;
      if (checkMove(indexFolders(snapshot.folders), items, folderId)) {
        return "refused";
      }
      const allThere = items.every((item) =>
        item.kind === "doc"
          ? (snapshot.items.find((doc) => doc.id === item.id)?.folderId ??
              null) === folderId
          : snapshot.folders.find((folder) => folder.id === item.id)
              ?.parentId === folderId,
      );
      return allThere ? "noop" : "ok";
    }
    case "pinned":
      return items.some(
        (item) =>
          item.kind === "doc" &&
          snapshot.items.find((doc) => doc.id === item.id)?.pinKey ===
            undefined,
      )
        ? "ok"
        : "noop";
    case "trash":
      return "ok";
    case "pin":
      return payload.fromPinned && items[0]?.id !== target.id ? "ok" : "noop";
  }
}
