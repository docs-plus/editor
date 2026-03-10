"use client";

import { useMemo } from "react";
import { scenarios } from "@/components/playground/playground-scenarios";
import { PlaygroundToolbar } from "@/components/playground/playground-toolbar";
import { TabBar } from "@/components/tab-bar";
import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor";
import { PLAYGROUND_ID, useTabs } from "@/hooks/use-tabs";

export default function Home() {
  const {
    ready,
    tabs,
    activeTabId,
    createTab,
    closeTab,
    switchTab,
    updateTabTitle,
  } = useTabs();

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
