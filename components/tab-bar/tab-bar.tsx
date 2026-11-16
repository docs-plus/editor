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
import {
  type ComponentType,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { OFFLINE_TAB_ACTION_HINT } from "@/components/pwa/offline-banner";
import type { RecentlyClosedMenuProps } from "@/components/tab-bar/recently-closed-menu";
import { TabContent } from "@/components/tab-bar/tab-content";
import type { RestorableTab } from "@/hooks/use-synced-tabs";
import { PLAYGROUND_ID } from "@/lib/constants";
import {
  CloseIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GripVerticalIcon,
  HistoryIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  RefreshCwIcon,
} from "@/lib/icons";
import type { Tab } from "@/lib/tab-entry";
import "./tab-bar.scss";

// The menu loads through the lazy restore chunk (fetched when the button
// is hovered or focused), so first load carries only the button.
const loadRecentlyClosedMenu = () =>
  import("@/lib/tab-restore").then((m) => m.loadRecentlyClosedMenu());

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  canCreateTab?: boolean;
  createTabLimitMessage?: string;
  /** Creating and closing tabs need the server; both are disabled offline. */
  offline?: boolean;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onReorder: (id: string, targetIndex: number) => void;
  /** Restores tabs picked from Recently closed. */
  onRestore: (tabs: readonly RestorableTab[]) => void;
  onPlaygroundRegenerate?: () => void;
}

/** History button and its lazy Recently closed menu. Needs the server. */
function RecentlyClosedButton({
  offline,
  onRestore,
}: {
  offline: boolean;
  onRestore: TabBarProps["onRestore"];
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [Menu, setMenu] = useState<ComponentType<RecentlyClosedMenuProps>>();
  const prefetch = () => {
    if (!Menu) loadRecentlyClosedMenu().then((menu) => setMenu(() => menu));
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="tab-bar-recently-closed"
        onClick={() => {
          prefetch();
          setOpen((current) => !current);
        }}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        disabled={offline}
        aria-label="Recently closed"
        aria-haspopup="menu"
        aria-expanded={open}
        title={offline ? OFFLINE_TAB_ACTION_HINT : "Recently closed"}
      >
        <HistoryIcon size={14} />
      </button>
      {Menu ? (
        <Menu
          open={open && !offline}
          onOpenChange={setOpen}
          anchorRef={buttonRef}
          onRestore={onRestore}
        />
      ) : null}
    </>
  );
}

function newTabLabel(canCreateTab: boolean, offline: boolean): string {
  if (offline) return "New tab (offline)";
  return canCreateTab ? "New tab (⌘T)" : "New tab (limit reached)";
}

function newTabTitle(
  canCreateTab: boolean,
  offline: boolean,
  limitMessage: string,
): string {
  if (offline) return OFFLINE_TAB_ACTION_HINT;
  return canCreateTab ? "New tab (⌘T)" : limitMessage;
}

function SortableTab({
  tab,
  isActive,
  tabsLength,
  offline,
  onSwitch,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  tabsLength: number;
  offline: boolean;
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
      <TabContent
        isActive={isActive}
        title={tab.title || "Untitled"}
        onSwitch={() => onSwitch(tab.id)}
        onAuxClick={(e) => {
          if (e.button === 1 && tabsLength > 1 && !offline) {
            e.preventDefault();
            onClose(tab.id);
          }
        }}
        leadingSlot={
          <span
            className="tab-bar-tab-drag-handle"
            {...attributes}
            {...listeners}
            aria-hidden
          >
            <GripVerticalIcon size={12} />
          </span>
        }
        icon={<FileTextIcon size={14} />}
        trailingSlot={
          tabsLength > 1 ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Close ${tab.title || "Untitled"}`}
              title={offline ? OFFLINE_TAB_ACTION_HINT : undefined}
              disabled={offline}
              className="tab-bar-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <CloseIcon size={12} />
            </button>
          ) : undefined
        }
      />
    </div>
  );
}

export function TabBar({
  tabs,
  activeTabId,
  canCreateTab = true,
  createTabLimitMessage = "Maximum tabs reached",
  offline = false,
  onSwitch,
  onCreate,
  onClose,
  onCloseAll,
  onReorder,
  onRestore,
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
        if (!canCreateTab || offline) return;
        onCreate();
      }

      if (mod && e.key === "w") {
        e.preventDefault();
        if (offline) return;
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
    [
      tabs,
      activeTabId,
      canCreateTab,
      offline,
      onCreate,
      onClose,
      onSwitch,
      onPlaygroundRegenerate,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [handleKeyboard]);

  const userTabs = tabs.filter((t) => t.id !== PLAYGROUND_ID);
  const userTabIds = userTabs.map((t) => t.id);
  const playgroundTab = tabs.find((t) => t.id === PLAYGROUND_ID);

  return (
    <div
      className="tab-bar"
      role="tablist"
      aria-label="Document tabs"
      data-nosnippet
    >
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
                <TabContent
                  isActive={activeTabId === PLAYGROUND_ID}
                  title={playgroundTab.title || "Playground"}
                  onSwitch={() => onSwitch(PLAYGROUND_ID)}
                  tabClassName="tab-bar-tab--playground"
                  icon={<FlaskConicalIcon size={14} />}
                  trailingSlot={
                    onPlaygroundRegenerate ? (
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
                    ) : undefined
                  }
                />
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
                offline={offline}
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
          disabled={!canCreateTab || offline}
          aria-label={newTabLabel(canCreateTab, offline)}
          title={newTabTitle(canCreateTab, offline, createTabLimitMessage)}
        >
          <PlusIcon size={14} />
        </button>
        <button
          type="button"
          className="tab-bar-close-all"
          onClick={onCloseAll}
          disabled={userTabs.length === 0 || offline}
          aria-label="Close all tabs"
          title={offline ? OFFLINE_TAB_ACTION_HINT : "Close all tabs"}
        >
          <PanelLeftCloseIcon size={14} />
        </button>
        <RecentlyClosedButton offline={offline} onRestore={onRestore} />
      </DndContext>
    </div>
  );
}
