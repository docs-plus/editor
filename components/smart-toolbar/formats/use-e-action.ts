"use client";

import type { Editor } from "@tiptap/react";
import { useSyncExternalStore } from "react";

import { useRememberedBundle } from "@/extensions/repeat-formatting/bundle-memory";
import { useActionView } from "@/hooks/use-editor-context";
import { availability } from "@/lib/editor-actions/registry";
import type { AnyAction } from "@/lib/editor-actions/types";
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
