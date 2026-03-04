"use client";

import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor";
import { TabBar } from "@/components/tab-bar";
import { useTabs } from "@/hooks/use-tabs";

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
      />
    </div>
  );
}
