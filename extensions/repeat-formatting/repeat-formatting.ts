import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { runAction } from "@/lib/editor-actions/registry";
import {
  getV11Engine,
  loadV11Engine,
  type RepeatSession,
  repeatApplyAction,
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
}

/**
 * Repeat formatting and Copy formatting (spec §5 M7). The extension is
 * the eager shell: it binds Mod-Alt-v (and F4 off macOS) through the
 * registry action, so read-only and disabled states return false and
 * leave the key alone, and it hands every transaction to the engine
 * (`lib/editor-actions/v11-engine.ts`), which records a bundle from local
 * mark-only transactions (contract §6, exception 3), keeps the "extend"
 * session as Yjs relative positions and applies a bundle as one undo step
 * that sets marks (never toggles). The engine chunk starts loading when
 * the editor is created; transactions before it lands are recorded in
 * order once it does, and the commands return false until then.
 */
export const RepeatFormatting = Extension.create<
  Record<string, never>,
  RepeatFormattingStorage
>({
  name: "repeatFormatting",

  addStorage() {
    return { session: { range: null }, pending: [] };
  },

  addCommands() {
    return {
      repeatFormatting: () => (props) =>
        getV11Engine()?.commands.repeatFormatting(props) ?? false,
      applyFormatBundle: (bundle) => (props) =>
        getV11Engine()?.commands.applyFormatBundle(bundle, props) ?? false,
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
    const repeat = () => runAction(this.editor, repeatApplyAction);
    const keys: Record<string, () => boolean> = { "Mod-Alt-v": repeat };
    // F4 is Repeat in Office on Windows/Linux; on macOS it is a system key.
    if (!isMac()) keys.F4 = repeat;
    return keys;
  },

  onCreate() {
    const { storage } = this;
    loadV11Engine().then(
      (engine) => {
        for (const { tr, state } of storage.pending.splice(0)) {
          engine.record(storage.session, tr, state);
        }
      },
      // Offline or a replaced chunk: E's actions stay unavailable and the
      // buffer stays capped; the next editor retries the fetch.
      () => undefined,
    );
  },

  onDestroy() {
    this.storage.session.range = null;
    this.storage.pending.length = 0;
  },

  onTransaction({ transaction: tr }) {
    const { storage } = this;
    const { state } = this.editor;
    const engine = getV11Engine();
    if (!engine) {
      if (storage.pending.push({ tr, state }) > MAX_PENDING) {
        storage.pending.shift();
      }
      return;
    }
    // The engine may land through another importer (the palette) before
    // this editor's load callback runs: keep the order.
    for (const entry of storage.pending.splice(0)) {
      engine.record(storage.session, entry.tr, entry.state);
    }
    engine.record(storage.session, tr, state);
  },
});
