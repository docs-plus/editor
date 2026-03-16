"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect } from "react";
import type { Tab } from "@/hooks/use-synced-tabs";
import { PLAYGROUND_ID } from "@/lib/constants";
import {
  CloseIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GripVerticalIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  RefreshCwIcon,
} from "@/lib/icons";
import "./tab-bar.scss";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onReorder: (id: string, targetIndex: number) => void;
  onPlaygroundRegenerate?: () => void;
}

function SortableTab({
  tab,
  isActive,
  tabsLength,
  onSwitch,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  tabsLength: number;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`tab-bar-tab-wrapper ${isDragging ? "tab-bar-tab-wrapper--dragging" : ""}`}
      data-tab-id={tab.id}
    >
      <div
        role="tab"
        tabIndex={isActive ? 0 : -1}
        aria-selected={isActive}
        className={`tab-bar-tab ${isActive ? "tab-bar-tab--active" : ""}`}
        onClick={() => onSwitch(tab.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSwitch(tab.id);
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1 && tabsLength > 1) {
            e.preventDefault();
            onClose(tab.id);
          }
        }}
      >
        <span
          className="tab-bar-tab-drag-handle"
          {...attributes}
          {...listeners}
          aria-hidden
        >
          <GripVerticalIcon size={12} />
        </span>
        <FileTextIcon size={14} className="tab-bar-tab-icon" />
        <span className="tab-bar-tab-title">{tab.title || "Untitled"}</span>
        {tabsLength > 1 && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Close ${tab.title || "Untitled"}`}
            className="tab-bar-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export function TabBar({
  tabs,
  activeTabId,
  onSwitch,
  onCreate,
  onClose,
  onCloseAll,
  onReorder,
  onPlaygroundRegenerate,
}: TabBarProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const current = tabs;
      const oldIndex = current.findIndex((t) => t.id === active.id);
      const newIndex = current.findIndex((t) => t.id === over.id);
      if (
        oldIndex < 0 ||
        newIndex < 0 ||
        oldIndex === newIndex ||
        active.id === PLAYGROUND_ID
      )
        return;
      onReorder(active.id as string, newIndex);
    },
    [tabs, onReorder],
  );

  const handleKeyboard = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "t") {
        e.preventDefault();
        onCreate();
      }

      if (mod && e.key === "w") {
        e.preventDefault();
        if (tabs.length > 1 && activeTabId !== PLAYGROUND_ID)
          onClose(activeTabId);
      }

      if (mod && e.shiftKey && e.key === "r") {
        e.preventDefault();
        if (activeTabId === PLAYGROUND_ID) onPlaygroundRegenerate?.();
      }

      if (mod && e.shiftKey && (e.key === "[" || e.key === "{")) {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx > 0) onSwitch(tabs[idx - 1].id);
      }

      if (mod && e.shiftKey && (e.key === "]" || e.key === "}")) {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx < tabs.length - 1) onSwitch(tabs[idx + 1].id);
      }
    },
    [tabs, activeTabId, onCreate, onClose, onSwitch, onPlaygroundRegenerate],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [handleKeyboard]);

  const userTabs = tabs.filter((t) => t.id !== PLAYGROUND_ID);
  const userTabIds = userTabs.map((t) => t.id);
  const playgroundTab = tabs.find((t) => t.id === PLAYGROUND_ID);

  return (
    <div className="tab-bar" role="tablist" aria-label="Document tabs">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <div className="tab-bar-tabs">
          {playgroundTab && (
            <>
              <div className="tab-bar-tab-wrapper" data-tab-id={PLAYGROUND_ID}>
                <div
                  role="tab"
                  tabIndex={activeTabId === PLAYGROUND_ID ? 0 : -1}
                  aria-selected={activeTabId === PLAYGROUND_ID}
                  className={`tab-bar-tab ${activeTabId === PLAYGROUND_ID ? "tab-bar-tab--active" : ""} tab-bar-tab--playground`}
                  onClick={() => onSwitch(PLAYGROUND_ID)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSwitch(PLAYGROUND_ID);
                    }
                  }}
                >
                  <FlaskConicalIcon size={14} className="tab-bar-tab-icon" />
                  <span className="tab-bar-tab-title">
                    {playgroundTab.title || "Playground"}
                  </span>
                  {onPlaygroundRegenerate && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Regenerate content (⌘⇧R)"
                      title="Regenerate content (⌘⇧R)"
                      className="tab-bar-tab-regenerate"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlaygroundRegenerate();
                      }}
                    >
                      <RefreshCwIcon size={12} />
                    </button>
                  )}
                </div>
              </div>
              {userTabs.length > 0 && <div className="tab-bar-divider" />}
            </>
          )}
          <SortableContext
            items={userTabIds}
            strategy={horizontalListSortingStrategy}
          >
            {userTabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                tabsLength={tabs.length}
                onSwitch={onSwitch}
                onClose={onClose}
              />
            ))}
          </SortableContext>
        </div>
        <button
          type="button"
          className="tab-bar-new"
          onClick={onCreate}
          aria-label="New tab (⌘T)"
          title="New tab (⌘T)"
        >
          <PlusIcon size={14} />
        </button>
        <button
          type="button"
          className="tab-bar-close-all"
          onClick={onCloseAll}
          disabled={userTabs.length === 0}
          aria-label="Close all tabs"
          title="Close all tabs"
        >
          <PanelLeftCloseIcon size={14} />
        </button>
      </DndContext>
    </div>
  );
}
