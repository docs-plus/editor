"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { DocumentEditor } from "@/components/document-editor";
import { TabBar } from "@/components/tab-bar";
import { useSyncedTabs } from "@/hooks/use-synced-tabs";
import { trackEvent } from "@/lib/analytics";

/** How long the intro waits for the collab server before showing a notice. */
const UNREACHABLE_AFTER_MS = 10_000;

interface EditorAppProps {
  /** Server-rendered content shown until the synced tabs are ready. */
  intro: ReactNode;
}

export function EditorApp({ intro }: EditorAppProps) {
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
  const [unreachable, setUnreachable] = useState(false);

  const handlePlaygroundRegenerate = useCallback(() => {
    setPlaygroundRegenerateTrigger((t) => t + 1);
    trackEvent("playground_regenerate", {});
  }, []);

  useEffect(() => {
    if (ready) {
      trackEvent("editor_ready", {});
      return;
    }
    const timer = setTimeout(() => setUnreachable(true), UNREACHABLE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready) {
    return (
      <>
        {intro}
        {unreachable && (
          <p role="alert" className="site-intro-offline">
            Can&apos;t reach the collaboration server. Check your connection and
            reload.
          </p>
        )}
      </>
    );
  }

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
