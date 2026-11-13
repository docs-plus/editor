"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useSyncExternalStore } from "react";

import { useRememberedBundle } from "@/extensions/repeat-formatting/bundle-memory";
import { useActionView } from "@/hooks/use-editor-context";
import { announce } from "@/lib/announce";
import { availability } from "@/lib/editor-actions/registry";
import type { AnyAction } from "@/lib/editor-actions/types";
import { getV11Engine, loadV11Engine } from "@/lib/editor-actions/v11-actions";
import { useV11EngineReady } from "@/lib/editor-actions/v11-engine-ready";
import { getEditorContextStore } from "@/lib/editor-context/store";
import {
  readSavedFormats,
  type SavedFormat,
  subscribeSavedFormats,
} from "@/lib/saved-formats";

/**
 * Why an E action cannot run now, or undefined. Re-renders on view
 * changes (the snapshot moved), on bundle changes (`repeat.apply` reads
 * the remembered bundle, a documented external read) and when the lazy
 * engine lands. Before it lands every E action is available: its run
 * waits for the engine (design pass, principle 4).
 */
export function useEActionReason(
  action: AnyAction,
  editor: Editor,
): string | undefined {
  useActionView(action.id, editor);
  useRememberedBundle();
  useV11EngineReady();
  const enabled = availability(
    action,
    getEditorContextStore(editor).getContext(),
  );
  return enabled === true ? undefined : enabled.reason;
}

/** The real failure the pill shows (design pass §5), with Retry. */
export const ENGINE_FAILED = "Couldn’t load formatting tools.";

/**
 * Runs `run` now when the engine is in; otherwise once it lands, if the
 * selection has not moved. A failed load (offline, a replaced chunk) says
 * so on the pill with Retry, which fetches again: loading itself is never
 * shown (design pass, principle 4).
 */
export function runWithEngine(editor: Editor, run: () => void): void {
  if (getV11Engine()) {
    run();
    return;
  }
  const { selection } = editor.state;
  loadV11Engine().then(
    () => {
      if (!editor.isDestroyed && editor.state.selection.eq(selection)) run();
    },
    () =>
      announce(ENGINE_FAILED, {
        action: { label: "Retry", run: () => runWithEngine(editor, run) },
      }),
  );
}

const noop = () => undefined;

/** Whether Paint format is armed on `editor`; re-renders when it changes. */
export function usePainting(editor: Editor): boolean {
  const ready = useV11EngineReady();
  // A new subscribe once the engine lands, so the store is subscribed.
  const subscribe = useCallback(
    (listener: () => void) =>
      (ready && getV11Engine()?.paint.subscribe(listener)) || noop,
    [ready],
  );
  return useSyncExternalStore(
    subscribe,
    () => getV11Engine()?.paint.isPainting(editor) ?? false,
    () => false,
  );
}

const NO_FORMATS: readonly SavedFormat[] = [];
const getNoFormats = () => NO_FORMATS;

/** Your formats; re-renders on saves, removals and other tabs' writes. */
export function useSavedFormats(): readonly SavedFormat[] {
  return useSyncExternalStore(
    subscribeSavedFormats,
    readSavedFormats,
    getNoFormats,
  );
}
