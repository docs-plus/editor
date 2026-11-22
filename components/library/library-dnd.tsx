"use client";

/**
 * Drag and drop in the files sidebar (details spec §6.1): documents and
 * folders onto a folder, the Library header (the root), Pinned or Trash,
 * and pinned rows onto each other to reorder. Pointer only: Move to… and
 * the context menu are the keyboard alternatives (dnd-kit's keyboard
 * sensor would take Enter and Space from the tree).
 *
 * - Folders open after 700 ms of hovering, or at once with Space.
 * - Several selected rows move together, all or none.
 * - Dropping where everything already is does nothing.
 * - A folder dropped into itself is refused: "A folder can't go inside
 *   itself." (the same rule as Move to…, `checkMove`).
 */
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { announce } from "@/lib/announce";
import { FileTextIcon, FolderIcon } from "@/lib/icons";
import {
  type DragPayload,
  type DropTarget,
  dropTargetId,
  dropVerdict,
} from "@/lib/library/drop-rules";
import {
  checkMove,
  indexFolders,
  moveRefusalMessage,
} from "@/lib/library/folder-rules";
import { pinnedEntries } from "@/lib/library/tree-rows";

import { useLibrary } from "./library-context";

export type { DragPayload, DropTarget };

/** A closed folder opens after this long under a drag. */
const SPRING_MS = 700;

interface DragState {
  active: DragPayload | null;
  overId: string | null;
  verdict: "ok" | "refused" | "noop" | null;
}

const DragContext = createContext<DragState>({
  active: null,
  overId: null,
  verdict: null,
});

/** "ok" or "refused" while something is dragged over this target. */
export function useDropHighlight(
  target: DropTarget | undefined,
): "ok" | "refused" | null {
  const state = useContext(DragContext);
  if (!target || state.overId !== dropTargetId(target)) return null;
  return state.verdict === "noop" ? null : state.verdict;
}

export function useIsDragging(): boolean {
  return useContext(DragContext).active !== null;
}

/**
 * A row that drags `payload` and, optionally, accepts drops as `target`.
 * Returns one ref for the element and the pointer listener to spread on it.
 * dnd-kit's `attributes` are not used: the row keeps its own role and
 * tabindex.
 */
export function useLibraryRowDnd(options: {
  dragId: string;
  payload: DragPayload;
  target?: DropTarget;
  disabled?: boolean;
}) {
  const { dragId, payload, target, disabled } = options;
  const drag = useDraggable({ id: dragId, data: payload, disabled });
  const drop = useDroppable({
    id: target ? dropTargetId(target) : `none-${dragId}`,
    data: target,
    disabled: !target,
  });
  const { setNodeRef: setDragRef } = drag;
  const { setNodeRef: setDropRef } = drop;
  const ref = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  return {
    ref,
    listeners: disabled ? undefined : drag.listeners,
    isDragging: drag.isDragging,
  };
}

/** A drop target that is not a row (the Library header, Pinned, Trash). */
export function useLibraryDropZone(target: DropTarget | undefined) {
  const unused = useId();
  const { setNodeRef } = useDroppable({
    id: target ? dropTargetId(target) : `none-${unused}`,
    data: target,
    disabled: !target,
  });
  return { ref: setNodeRef, highlight: useDropHighlight(target) };
}

export function LibraryDnd({ children }: { children: ReactNode }) {
  const { snapshot, actions, expanded } = useLibrary();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [state, setState] = useState<DragState>({
    active: null,
    overId: null,
    verdict: null,
  });
  const springTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const overFolder = useRef<string | null>(null);
  const latest = useRef({ snapshot, expanded });
  latest.current = { snapshot, expanded };

  const clearSpring = useCallback(() => {
    clearTimeout(springTimer.current);
    springTimer.current = undefined;
  }, []);

  // Space opens the hovered folder at once while dragging.
  useEffect(() => {
    if (!state.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || !overFolder.current) return;
      event.preventDefault();
      clearSpring();
      actions.toggleFolder(overFolder.current, true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [state.active, actions, clearSpring]);

  useEffect(() => clearSpring, [clearSpring]);

  const onDragStart = (event: DragStartEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    if (!payload) return;
    setState({ active: payload, overId: null, verdict: null });
  };

  const onDragOver = (event: DragOverEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    const target = event.over?.data.current as DropTarget | undefined;
    const overId = event.over ? String(event.over.id) : null;
    if (!payload) return;
    const verdict = target
      ? dropVerdict(latest.current.snapshot, payload, target)
      : null;
    setState({ active: payload, overId, verdict });
    const folderId = target?.kind === "folder" ? target.id : null;
    if (folderId !== overFolder.current) {
      clearSpring();
      overFolder.current = folderId;
      if (folderId && !latest.current.expanded.has(folderId)) {
        springTimer.current = setTimeout(
          () => actions.toggleFolder(folderId, true),
          SPRING_MS,
        );
      }
    }
  };

  const finish = () => {
    clearSpring();
    overFolder.current = null;
    setState({ active: null, overId: null, verdict: null });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    const target = event.over?.data.current as DropTarget | undefined;
    finish();
    if (!payload || !target) return;
    const { snapshot: snap } = latest.current;
    const verdict = dropVerdict(snap, payload, target);
    if (verdict === "noop") return;
    if (verdict === "refused") {
      const folderId = target.kind === "folder" ? target.id : null;
      const reason = checkMove(
        indexFolders(snap.folders),
        payload.items,
        folderId,
      );
      if (reason) announce(moveRefusalMessage(reason));
      return;
    }
    switch (target.kind) {
      case "folder":
        actions.move(payload.items, target.id);
        return;
      case "root":
        actions.move(payload.items, null);
        return;
      case "trash":
        actions.trash(payload.items);
        return;
      case "pinned":
        for (const item of payload.items) {
          if (item.kind === "doc") actions.pin(item.id);
        }
        return;
      case "pin": {
        const to = pinnedEntries(snap).findIndex(
          (item) => item.id === target.id,
        );
        const dragged = payload.items[0];
        if (dragged && to >= 0) actions.movePin(dragged.id, to);
        return;
      }
    }
  };

  const announcements = useMemo(
    () => ({
      onDragStart: () => "",
      onDragOver: () => "",
      onDragEnd: () => "",
      onDragCancel: () => "",
    }),
    [],
  );

  const first = state.active?.items[0];
  return (
    <DragContext.Provider value={state}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={finish}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: "" },
        }}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {state.active ? (
            <div className="lib-drag-chip">
              {first?.kind === "folder" ? (
                <FolderIcon aria-hidden="true" />
              ) : (
                <FileTextIcon aria-hidden="true" />
              )}
              <bdi dir="auto">
                {state.active.items.length > 1
                  ? `${state.active.items.length} items`
                  : state.active.label}
              </bdi>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </DragContext.Provider>
  );
}
