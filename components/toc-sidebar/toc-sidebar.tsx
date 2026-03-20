"use client";

import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Editor } from "@tiptap/core";
import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SortableTocItem } from "@/components/toc-sidebar/sortable-toc-item";
import { computeSection, findAllSections } from "@/extensions/shared";
import { moveSection } from "@/lib/editor-utils";
import { cn } from "@/lib/utils";

import "./toc-sidebar.scss";

const LEVEL_STEP_PX = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface TocSidebarProps {
  items: TableOfContentData;
  editor: Editor | null;
  foldedIds: Set<string>;
  onToggleFold: (id: string) => void;
  filteredIds?: Set<string>;
  previewMatchIds?: Set<string>;
}

function filterItemsByFoldState(
  items: TableOfContentData,
  foldedIds: Set<string>,
): { visible: TableOfContentData; foldableIds: Set<string> } {
  const visible: TableOfContentData = [];
  const foldableIds = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    if (i === 0) continue;
    const next = items[i + 1];
    if (next && next.level > items[i].level) {
      foldableIds.add(items[i].id);
    }
  }

  const foldStack: number[] = [];

  for (const item of items) {
    while (
      foldStack.length > 0 &&
      item.level <= foldStack[foldStack.length - 1]
    ) {
      foldStack.pop();
    }

    if (foldStack.length > 0) continue;

    visible.push(item);

    if (foldedIds.has(item.id)) {
      foldStack.push(item.level);
    }
  }

  return { visible, foldableIds };
}

export function TocSidebar({
  items,
  editor,
  foldedIds,
  onToggleFold,
  filteredIds,
  previewMatchIds,
}: TocSidebarProps) {
  const isFiltering = filteredIds != null;
  const isPreviewing = previewMatchIds != null;
  const activeRef = useRef<HTMLButtonElement>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [displayLevel, setDisplayLevel] = useState<number | null>(null);
  const displayLevelRef = useRef<number | null>(null);
  const offsetLeftRef = useRef(0);
  const activeItemRef = useRef<TableOfContentData[number] | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const handleClick = useCallback(
    (item: TableOfContentData[number]) => {
      if (!editor) return;
      const node = editor.state.doc.nodeAt(item.pos);
      const endPos = node ? item.pos + node.nodeSize - 1 : item.pos + 1;
      editor.commands.setTextSelection(endPos);
      editor.commands.focus();
      requestAnimationFrame(() => {
        item.dom.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [editor],
  );

  const { visible, foldableIds } = useMemo(
    () => filterItemsByFoldState(items, foldedIds),
    [items, foldedIds],
  );

  const sortableIds = useMemo(() => visible.map((item) => item.id), [visible]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback(
    ({ active }: DragStartEvent) => {
      const item = visible.find((v) => v.id === active.id) ?? null;
      activeItemRef.current = item;
      setActiveId(active.id as string);
      const level = item?.level ?? null;
      setDisplayLevel(level);
      displayLevelRef.current = level;
      offsetLeftRef.current = 0;
    },
    [visible],
  );

  const handleDragMove = useCallback(({ delta }: DragMoveEvent) => {
    offsetLeftRef.current = delta.x;
    const item = activeItemRef.current;
    if (!item) return;
    const newLevel = clamp(
      item.level + Math.round(delta.x / LEVEL_STEP_PX),
      1,
      6,
    );
    displayLevelRef.current = newLevel;
    setDisplayLevel((prev) => (prev === newLevel ? prev : newLevel));
  }, []);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const draggedId = active.id as string;
      const overId = over?.id as string | undefined;
      const deltaX = offsetLeftRef.current;

      setActiveId(null);
      setDisplayLevel(null);
      offsetLeftRef.current = 0;
      activeItemRef.current = null;

      if (!editor || !overId) return;

      const doc = editor.state.doc;
      const sections = findAllSections(doc);
      const activeSection = sections.find((s) => s.id === draggedId);
      if (!activeSection) return;

      const { from: sectionFrom, to: sectionTo } = computeSection(
        doc,
        activeSection.pos,
        activeSection.level,
        activeSection.childIndex,
      );

      const targetLevel = clamp(
        activeSection.level + Math.round(deltaX / LEVEL_STEP_PX),
        1,
        6,
      );

      const levelChanged = targetLevel !== activeSection.level;
      const positionChanged = draggedId !== overId;

      if (!positionChanged && !levelChanged) return;

      let targetPos: number;
      if (!positionChanged) {
        targetPos = sectionFrom;
      } else {
        const overSection = sections.find((s) => s.id === overId);
        if (!overSection) return;

        const activeIdx = visible.findIndex((v) => v.id === draggedId);
        const overIdx = visible.findIndex((v) => v.id === overId);

        if (overIdx > activeIdx) {
          const { to } = computeSection(
            doc,
            overSection.pos,
            overSection.level,
            overSection.childIndex,
          );
          targetPos = to;
        } else {
          targetPos = overSection.pos;
        }
      }

      moveSection(
        editor.view,
        sectionFrom,
        sectionTo,
        targetPos,
        levelChanged ? targetLevel : undefined,
      );
    },
    [editor, visible],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setDisplayLevel(null);
    offsetLeftRef.current = 0;
    activeItemRef.current = null;
  }, []);

  const activeItem = activeId ? visible.find((v) => v.id === activeId) : null;

  const announcements: Announcements = useMemo(
    () => ({
      onDragStart({ active }) {
        const item = visible.find((v) => v.id === active.id);
        return item
          ? `Picked up heading "${item.textContent}". Current level: H${item.level}.`
          : "";
      },
      onDragOver({ active, over }) {
        const overItem = over ? visible.find((v) => v.id === over.id) : null;
        const activeItem = visible.find((v) => v.id === active.id);
        if (!overItem || !activeItem) return "";
        return `Over "${overItem.textContent}".`;
      },
      onDragEnd({ active, over }) {
        const item = visible.find((v) => v.id === active.id);
        if (!item) return "";
        const level = displayLevelRef.current ?? item.level;
        return over
          ? `Dropped "${item.textContent}" at level H${level}.`
          : `Cancelled dragging "${item.textContent}".`;
      },
      onDragCancel({ active }) {
        const item = visible.find((v) => v.id === active.id);
        return item ? `Cancelled dragging "${item.textContent}".` : "";
      },
    }),
    [visible],
  );

  return (
    <nav className="toc-sidebar" aria-label="Document outline">
      <div className="toc-sidebar-header">Outline</div>
      {items.length === 0 ? (
        <p className="toc-sidebar-empty">Add headings to see an outline</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          accessibility={{ announcements }}
        >
          <SortableContext
            items={sortableIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="toc-sidebar-items" role="tree">
              {visible.map((item, idx) => (
                <SortableTocItem
                  key={item.id}
                  item={item}
                  idx={idx}
                  isTitle={item === items[0]}
                  isFoldable={foldableIds.has(item.id)}
                  isFolded={foldedIds.has(item.id)}
                  isFiltering={isFiltering}
                  isPreviewing={isPreviewing}
                  filteredIds={filteredIds}
                  previewMatchIds={previewMatchIds}
                  activeRef={activeRef}
                  onToggleFold={onToggleFold}
                  onClick={handleClick}
                />
              ))}
            </div>
          </SortableContext>
          {typeof document !== "undefined" &&
            createPortal(
              <DragOverlay>
                {activeItem && displayLevel != null ? (
                  <div
                    className={cn(
                      "toc-sidebar-drag-ghost",
                      `toc-sidebar-drag-ghost--h${displayLevel}`,
                    )}
                  >
                    <span className="toc-sidebar-drag-ghost-badge">
                      H{displayLevel}
                    </span>
                    <span className="toc-sidebar-drag-ghost-text">
                      {activeItem.textContent}
                    </span>
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
        </DndContext>
      )}
    </nav>
  );
}
