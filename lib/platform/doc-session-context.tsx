"use client";

/**
 * How the editor gets its `DocSession` (desktop architecture §4). Each
 * composition root (the web `EditorApp`, later `DesktopRoot` and the
 * library root) provides one **inside a component**; `use-yjs-document`
 * reads it here. So the editor chunk imports no adapter, and the sandbox's
 * `collab-session` never enters the desktop graph.
 *
 * Provide the session through this context, never as a hook parameter with
 * a default value: the production minifier inlines that default as a new
 * function on every render, which re-runs any effect depending on it (P2.3).
 */
import { createContext, type ReactNode, useContext } from "react";

import type { DocSession } from "@/lib/platform/doc-session";

const DocSessionContext = createContext<DocSession | null>(null);

export function DocSessionProvider({
  session,
  children,
}: {
  /** Keep it stable: a new session reopens every document. */
  session: DocSession;
  children: ReactNode;
}) {
  return (
    <DocSessionContext.Provider value={session}>
      {children}
    </DocSessionContext.Provider>
  );
}

/** The `DocSession` of the nearest `DocSessionProvider`. Throws without one. */
export function useDocSession(): DocSession {
  const session = useContext(DocSessionContext);
  // Short: this string ships in the editor chunk.
  if (!session) throw new Error("No DocSessionProvider");
  return session;
}
