import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

import {
  getV11Engine,
  loadV11Engine,
  type RepeatSession,
  subscribeV11Engine,
  type V11Engine,
} from "@/lib/editor-actions/v11-actions";
import { isMac } from "@/lib/shortcuts";

import type { FormatBundle } from "./bundle";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    repeatFormatting: {
      /** Applies the remembered bundle to the selection: one undo step. */
      repeatFormatting: () => ReturnType;
      /** Closes the extend session; `repeat.copy` remembers the read. */
      copyFormatting: () => ReturnType;
      /** Applies `bundle` (a saved or in-doc format); `formats.apply` remembers it. */
      applyFormatBundle: (bundle: FormatBundle) => ReturnType;
    };
  }
}

/** Transactions kept while the engine chunk loads (it takes milliseconds). */
const MAX_PENDING = 50;

export interface RepeatFormattingStorage {
  /** The "extend" session: per editor, memory only. */
  session: RepeatSession;
  /** Transactions seen before the engine landed, recorded once it does. */
  pending: { tr: Transaction; state: EditorState }[];
  /** Stops waiting for the engine (set while it is on its way). */
  unwait: (() => void) | null;
}

/**
 * Whether the recorder could act on `tr`: remote edits and meta-only
 * transactions (carets, plugin state) never record, so buffering them
 * would only push the user's own out of the capped buffer. Undo and redo
 * (sync meta with `isUndoRedoOperation`) close the session: kept.
 */
function recordable(tr: Transaction): boolean {
  const sync = tr.getMeta(ySyncPluginKey) as
    | { isUndoRedoOperation?: boolean }
    | undefined;
  if (sync) return sync.isUndoRedoOperation === true;
  return tr.docChanged || tr.selectionSet;
}

/**
 * Records the buffered transactions, oldest first, and returns the
 * engine; null while it is still loading. Every engine use goes through
 * here, so the bundle and the session are current before anything reads
 * them.
 */
function drain(storage: RepeatFormattingStorage): V11Engine | null {
  const engine = getV11Engine();
  if (engine) {
    for (const { tr, state } of storage.pending.splice(0)) {
      engine.record(storage.session, tr, state);
    }
  }
  return engine;
}

/**
 * Repeat formatting and Copy formatting (spec §5 M7). The extension is
 * the eager shell: it binds Mod-Alt-v (and F4 off macOS), and it hands
 * every transaction to the engine (`lib/editor-actions/v11-engine.ts`),
 * which records a bundle from local mark-only transactions (contract §6,
 * exception 3), keeps the "extend" session as Yjs relative positions and
 * applies a bundle as one undo step that sets marks (never toggles). The
 * engine chunk starts loading when the editor is created; transactions
 * before it lands are recorded in order once it does, and the commands
 * return false until then. In an editable editor the key is always
 * handled: it repeats, or announces why it cannot.
 */
export const RepeatFormatting = Extension.create<
  Record<string, never>,
  RepeatFormattingStorage
>({
  name: "repeatFormatting",

  addStorage() {
    return {
      session: { range: null, bundle: null },
      pending: [],
      unwait: null,
    };
  },

  addCommands() {
    return {
      repeatFormatting: () => (props) =>
        drain(this.storage)?.commands.repeatFormatting(props) ?? false,
      applyFormatBundle: (bundle) => (props) =>
        drain(this.storage)?.commands.applyFormatBundle(bundle, props) ?? false,
      // Memory is written by the actions' run(), after these return true
      // (contract §6); the commands only touch the editor.
      copyFormatting:
        () =>
        ({ dispatch }) => {
          if (dispatch) this.storage.session.range = null;
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const repeat = () => {
      const { editor, storage } = this;
      if (!editor.isEditable) return false;
      const engine = drain(storage);
      if (engine) return engine.repeatKey(editor);
      // The engine chunk is still loading (slow network, busy device):
      // take the key and repeat once it lands, if the selection has not
      // moved. The buffered transactions are recorded first, so the
      // bundle is current.
      const { from, to } = editor.state.selection;
      loadV11Engine().then(
        () => {
          if (editor.isDestroyed) return;
          const loaded = drain(storage);
          const now = editor.state.selection;
          if (loaded && now.from === from && now.to === to) {
            loaded.repeatKey(editor);
          }
        },
        () => undefined,
      );
      return true;
    };
    const keys: Record<string, () => boolean> = { "Mod-Alt-v": repeat };
    // F4 is Repeat in Office on Windows/Linux; on macOS it is a system key.
    if (!isMac()) keys.F4 = repeat;
    return keys;
  },

  onCreate() {
    const { editor, storage } = this;
    if (drain(storage)) return;
    // Waits for the engine from any importer (this load, or a retry by the
    // palette after this one failed offline). Views cached before it
    // landed still say "still loading": a no-op stored-marks transaction
    // moves this editor's toolbar version so they are read again.
    storage.unwait = subscribeV11Engine(() => {
      storage.unwait?.();
      storage.unwait = null;
      drain(storage);
      if (editor.isDestroyed) return;
      const { tr } = editor.state;
      editor.view.dispatch(
        tr.setStoredMarks(tr.storedMarks).setMeta("addToHistory", false),
      );
    });
    // Offline or a replaced chunk: E's actions stay unavailable and the
    // buffer stays capped; the next load retries the fetch.
    loadV11Engine().catch(() => undefined);
  },

  onDestroy() {
    const { storage } = this;
    storage.unwait?.();
    storage.unwait = null;
    storage.session.range = null;
    storage.pending.length = 0;
  },

  onTransaction({ transaction: tr }) {
    const { storage } = this;
    const engine = drain(storage);
    if (engine) {
      engine.record(storage.session, tr, this.editor.state);
    } else if (
      recordable(tr) &&
      storage.pending.push({ tr, state: this.editor.state }) > MAX_PENDING
    ) {
      storage.pending.shift();
    }
  },
});
