"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  closeSlash,
  getSlashState,
  type SlashState,
} from "@/extensions/slash-trigger/slash-trigger";

import type { SurfaceProps } from "./types";

type SlashMenuModule = typeof import("./slash/slash-menu");

let loaded: SlashMenuModule | null = null;
let loading: Promise<SlashMenuModule> | null = null;

/**
 * The menu chunk. One fetch at a time; a failed one clears, so the next
 * "/" tries again. (Before E's engine lands, Diagram is one row that runs
 * at once; its templates join once the engine is in.)
 */
const loadSlashMenu = () =>
  (loading ??= import("./slash/slash-menu").then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  ));

const CLOSED: SlashState = { open: false };

/**
 * The "/" block menu's host (eager, small). Renders the lazy menu while
 * the trigger's state is open. It follows the editor's own events:
 * `transaction` (the state can only change there) and `update`, which
 * `setEditable` emits without a transaction, so a document turning
 * read-only closes the menu. The chunk is fetched when the browser is
 * idle after the host mounts, and at the latest on the first "/"; a chunk
 * that does not load shows nothing (the "/" stays text) and the next "/"
 * tries again. The menu renders directly once loaded, never through
 * `lazy()`, whose first render suspends even for a cached chunk (A13). The
 * polite live region lives here for the editor's whole life, so the
 * menu's first announcement is read.
 */
export function SlashMenuHost({ editor = null }: SurfaceProps) {
  const [status, setStatus] = useState("");
  const [, setLoaded] = useState(loaded);
  const state = useSyncExternalStore(
    (listener) => {
      if (!editor) return () => undefined;
      const update = () => {
        if (!editor.isEditable) closeSlash(editor);
        listener();
      };
      editor.on("transaction", listener);
      editor.on("update", update);
      return () => {
        editor.off("transaction", listener);
        editor.off("update", update);
      };
    },
    () => (editor ? getSlashState(editor) : CLOSED),
    () => CLOSED,
  );
  const open = editor && state.open ? state : null;

  useEffect(() => {
    if (loaded) return;
    const load = () => loadSlashMenu().then(setLoaded, () => undefined);
    if (open) load();
    else (window.requestIdleCallback ?? setTimeout)(load);
  }, [open]);

  const Menu = loaded?.SlashMenu;
  return (
    <>
      <div role="status" className="sr-only" data-slash-status="">
        {open ? status : ""}
      </div>
      {open && Menu && editor ? (
        <Menu editor={editor} state={open} announce={setStatus} />
      ) : null}
    </>
  );
}
