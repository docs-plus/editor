"use client";

import { useMemo } from "react";
import { scenarios } from "@/components/playground/playground-scenarios";
import { PlaygroundToolbar } from "@/components/playground/playground-toolbar";
import { TabBar } from "@/components/tab-bar";
import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor";
import { useSyncedTabs } from "@/hooks/use-synced-tabs";
import { PLAYGROUND_ID } from "@/lib/constants";

export default function Home() {
  const {
    ready,
    tabs,
    activeTabId,
    createTab,
    closeTab,
    closeAllTabs,
    reorderTab,
    switchTab,
    updateTabTitle,
  } = useSyncedTabs();

  const isPlayground = activeTabId === PLAYGROUND_ID;

  const playgroundContent = useMemo(
    () => (isPlayground ? scenarios[0]?.generate() : undefined),
    [isPlayground],
  );

  if (!ready) return null;

  return (
    <div className="app-shell">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitch={switchTab}
        onCreate={createTab}
        onClose={closeTab}
        onCloseAll={closeAllTabs}
        onReorder={reorderTab}
      />
      <SimpleEditor
        key={activeTabId}
        documentId={activeTabId}
        onTitleChange={(title) => updateTabTitle(activeTabId, title)}
        initialContent={playgroundContent}
        toolbar={isPlayground ? <PlaygroundToolbar /> : undefined}
      />
    </div>
  );
}
