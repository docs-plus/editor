"use client";

import { useCallback, useEffect } from "react";
import { PLAYGROUND_ID, type Tab } from "@/hooks/use-tabs";
import {
  CloseIcon,
  FileTextIcon,
  FlaskConicalIcon,
  PlusIcon,
} from "@/lib/icons";
import "./tab-bar.scss";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSwitch,
  onCreate,
  onClose,
}: TabBarProps) {
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
    [tabs, activeTabId, onCreate, onClose, onSwitch],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [handleKeyboard]);

  return (
    <div className="tab-bar" role="tablist" aria-label="Document tabs">
      <div className="tab-bar-tabs">
        {tabs.map((tab, i) => {
          const isActive = tab.id === activeTabId;
          const isPlayground = tab.id === PLAYGROUND_ID;
          const nextIsUserTab =
            isPlayground &&
            i + 1 < tabs.length &&
            tabs[i + 1].id !== PLAYGROUND_ID;

          return (
            <div key={tab.id} className="tab-bar-tab-wrapper">
              <div
                role="tab"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                className={`tab-bar-tab ${isActive ? "tab-bar-tab--active" : ""} ${isPlayground ? "tab-bar-tab--playground" : ""}`}
                onClick={() => onSwitch(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSwitch(tab.id);
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button === 1 && tabs.length > 1 && !isPlayground) {
                    e.preventDefault();
                    onClose(tab.id);
                  }
                }}
              >
                {isPlayground ? (
                  <FlaskConicalIcon size={14} className="tab-bar-tab-icon" />
                ) : (
                  <FileTextIcon size={14} className="tab-bar-tab-icon" />
                )}
                <span className="tab-bar-tab-title">
                  {tab.title || "Untitled"}
                </span>
                {tabs.length > 1 && !isPlayground && (
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
              {nextIsUserTab && <div className="tab-bar-divider" />}
            </div>
          );
        })}
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
    </div>
  );
}
