"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import {
  AppSkeleton,
  SkeletonDocument,
  SkeletonEditorBody,
} from "@/components/app-skeleton";
import { TabBar } from "@/components/tab-bar";
import { useSyncedTabs } from "@/hooks/use-synced-tabs";
import { trackEvent } from "@/lib/analytics";
import {
  hasUnsyncedCollabChanges,
  subscribeUnsyncedChanges,
} from "@/lib/collab-session";

/** How long the intro waits for the collab server before showing a notice. */
const UNREACHABLE_AFTER_MS = 10_000;

/**
 * The editor (Tiptap, ProseMirror, extensions, highlighting) is most of the
 * app's JavaScript. Loading it as its own chunk lets the page hydrate and
 * open the WebSocket first; the chunk downloads while the tab list syncs.
 */
const loadDocumentEditor = () =>
  import("@/components/document-editor/document-editor").then(
    (module) => module.DocumentEditor,
  );

const DocumentEditor = dynamic(loadDocumentEditor, {
  ssr: false,
  loading: () => (
    <SkeletonEditorBody>
      <SkeletonDocument />
    </SkeletonEditorBody>
  ),
});

function confirmUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = ""; // Safari and older Chromium
}

/**
 * Asks before closing or reloading while edits have not reached the server.
 * The listener exists only while they are pending, so the page stays
 * eligible for the back/forward cache, and no React state changes per
 * keystroke (each edit is pending until the server acknowledges it).
 */
function useUnsyncedChangesGuard(): void {
  useEffect(() => {
    let guarded = false;
    const update = () => {
      const unsynced = hasUnsyncedCollabChanges();
      if (unsynced === guarded) return;
      guarded = unsynced;
      if (unsynced) window.addEventListener("beforeunload", confirmUnload);
      else window.removeEventListener("beforeunload", confirmUnload);
    };
    const unsubscribe = subscribeUnsyncedChanges(update);
    update();
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", confirmUnload);
    };
  }, []);
}

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
  useUnsyncedChangesGuard();

  const handlePlaygroundRegenerate = useCallback(() => {
    setPlaygroundRegenerateTrigger((t) => t + 1);
    trackEvent("playground_regenerate", {});
  }, []);

  useEffect(() => {
    void loadDocumentEditor();
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
        <AppSkeleton>{intro}</AppSkeleton>
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
