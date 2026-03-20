"use client";

import { useCallback, useState } from "react";

import { DocumentEditor } from "@/components/document-editor";
import { TabBar } from "@/components/tab-bar";
import { useSyncedTabs } from "@/hooks/use-synced-tabs";

export default function Home() {
  const {
    ready,
    tabs,
    activeTabId,
    canCreateTab,
    createTabLimitMessage,
    createTab,
    closeTab,
    closeAllTabs,
    reorderTab,
    switchTab,
    updateTabTitle,
  } = useSyncedTabs();

  const [playgroundRegenerateTrigger, setPlaygroundRegenerateTrigger] =
    useState(0);

  const handlePlaygroundRegenerate = useCallback(() => {
    setPlaygroundRegenerateTrigger((t) => t + 1);
  }, []);

  if (!ready) return null;

  return (
    <div className="app-shell">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        canCreateTab={canCreateTab}
        createTabLimitMessage={createTabLimitMessage}
        onSwitch={switchTab}
        onCreate={createTab}
        onClose={closeTab}
        onCloseAll={closeAllTabs}
        onReorder={reorderTab}
        onPlaygroundRegenerate={handlePlaygroundRegenerate}
      />
      <DocumentEditor
        key={activeTabId}
        documentId={activeTabId}
        onTitleChange={(title) => updateTabTitle(activeTabId, title)}
        playgroundRegenerateTrigger={playgroundRegenerateTrigger}
      />
    </div>
  );
}
