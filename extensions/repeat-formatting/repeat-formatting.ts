import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey, yUndoPluginKey } from "@tiptap/y-tiptap";

import { runAction } from "@/lib/editor-actions/registry";
import { repeatApplyAction } from "@/lib/editor-actions/v11-actions";
import { isMac } from "@/lib/shortcuts";

import {
  applyBundle,
  applyDisabledReason,
  bundlePatchFromSteps,
  REPEAT_META,
  repeatDisabledReason,
} from "./apply-bundle";
import { type FormatBundle, isEmptyBundle, readBundleAt } from "./bundle";
import { getRememberedBundle, rememberBundle } from "./bundle-memory";
import {
  fromSessionRange,
  mapSessionRange,
  type SessionRange,
  sameRange,
  toSessionRange,
} from "./relative-range";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    repeatFormatting: {
      /** Applies the remembered bundle to the selection: one undo step. */
      repeatFormatting: () => ReturnType;
      /** Remembers the selection's full formatting as the bundle. */
      copyFormatting: () => ReturnType;
      /** Applies `bundle` (a saved or in-doc format) and remembers it. */
      applyFormatBundle: (bundle: FormatBundle) => ReturnType;
    };
  }
}

export interface RepeatFormattingStorage {
  /** The "extend" session: per editor, memory only. */
  session: SessionRange | null;
}

interface UndoManagerLike {
  stopCapturing(): void;
}

function undoManagerOf(state: EditorState): UndoManagerLike | null {
  return (
    (yUndoPluginKey.getState(state)?.undoManager as
      | UndoManagerLike
      | undefined) ?? null
  );
}

/**
 * Repeat formatting and Copy formatting (spec §5 M7). Records a bundle
 * from local mark steps, keeps the "extend" session as Yjs relative
 * positions, applies a bundle as one transaction that sets marks (never
 * toggles) wrapped in `stopCapturing()` so it is exactly one undo step,
 * and binds Mod-Alt-v (and F4 off macOS) through the registry action, so
 * read-only and disabled states return false and leave the key alone.
 */
export const RepeatFormatting = Extension.create<
  Record<string, never>,
  RepeatFormattingStorage
>({
  name: "repeatFormatting",

  addStorage() {
    return { session: null };
  },

  addCommands() {
    const apply =
      (bundle: FormatBundle, remember: boolean) =>
      ({
        state,
        tr,
        dispatch,
        editor,
      }: {
        state: EditorState;
        tr: Transaction;
        dispatch?: (tr: Transaction) => void;
        editor: { isEditable: boolean };
      }) => {
        if (!editor.isEditable) return false;
        if (applyDisabledReason(state, bundle) !== null) return false;
        if (!dispatch) return true;
        const undoManager = undoManagerOf(state);
        undoManager?.stopCapturing();
        // `onTransaction` stops capturing again once the Yjs write is done,
        // so typing that follows is its own undo step.
        applyBundle(tr, bundle).setMeta(REPEAT_META, true);
        if (remember) rememberBundle(bundle);
        return true;
      };

    return {
      repeatFormatting:
        () =>
        ({ state, tr, dispatch, editor }) => {
          const bundle = getRememberedBundle();
          if (repeatDisabledReason(state, bundle) !== null || !bundle) {
            return false;
          }
          return apply(bundle, false)({ state, tr, dispatch, editor });
        },
      applyFormatBundle:
        (bundle) =>
        ({ state, tr, dispatch, editor }) => {
          if (isEmptyBundle(bundle)) return false;
          return apply(bundle, true)({ state, tr, dispatch, editor });
        },
      copyFormatting:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) {
            rememberBundle(readBundleAt(state));
            this.storage.session = null;
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const repeat = () => runAction(this.editor, repeatApplyAction);
    const keys: Record<string, () => boolean> = { "Mod-Alt-v": repeat };
    // F4 is Repeat in Office on Windows/Linux; on macOS it is a system key.
    if (!isMac()) keys.F4 = repeat;
    return keys;
  },

  onDestroy() {
    this.storage.session = null;
  },

  onTransaction({ transaction: tr }) {
    const { storage } = this;
    if (tr.getMeta(REPEAT_META)) {
      undoManagerOf(this.editor.state)?.stopCapturing();
      storage.session = toSessionRange(this.editor.state, tr.selection);
      return;
    }
    const sync = tr.getMeta(ySyncPluginKey) as
      | { isUndoRedoOperation?: boolean }
      | undefined;
    if (sync) {
      // Remote edits never record or close; undo and redo close.
      if (sync.isUndoRedoOperation) storage.session = null;
      return;
    }
    if (storage.session) storage.session = mapSessionRange(storage.session, tr);
    if (!tr.docChanged && !tr.selectionSet) return;
    const { state } = this.editor;
    const { selection } = state;
    const patch = tr.docChanged ? bundlePatchFromSteps(tr) : {};
    if (!isEmptyBundle(patch) && !selection.empty) {
      const same =
        storage.session !== null &&
        sameRange(fromSessionRange(state, storage.session), selection);
      const base = same ? getRememberedBundle() : null;
      rememberBundle(base ? { ...base, ...patch } : patch);
      storage.session = toSessionRange(state, selection);
    } else if (
      tr.selectionSet &&
      storage.session &&
      !sameRange(fromSessionRange(state, storage.session), selection)
    ) {
      storage.session = null;
    }
  },
});
