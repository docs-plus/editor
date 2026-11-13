"use client";

import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import { useSyncExternalStore } from "react";

/**
 * How long toolbar state may trail the document while it changes. Typing
 * fires a document change per keystroke, and every toolbar control re-runs
 * its `editor.can()` / `isActive` checks when it renders, so controls catch
 * up once changes pause instead of on every keystroke.
 */
export const TOOLBAR_SETTLE_MS = 150;

/**
 * The longest toolbar state may trail the document while remote changes
 * never pause, such as a collaborator who keeps typing: the toolbar catches
 * up at least this often instead of waiting for {@link TOOLBAR_SETTLE_MS} of
 * quiet. Local typing is exempt: the user's own keystrokes would force a
 * toolbar commit about once a second, a long task the settle timer avoids.
 */
export const TOOLBAR_MAX_WAIT_MS = 1000;

interface EditorVersionStore {
  subscribe: (listener: () => void) => () => void;
  getVersion: () => number;
}

const stores = new WeakMap<Editor, EditorVersionStore>();

/**
 * Whether a transaction that leaves the document alone can change what a
 * toolbar control shows. Meta-only transactions (collaboration cursors,
 * which follow every local keystroke, and plugin state) cannot.
 */
function changesToolbarContext(tr: Transaction): boolean {
  return (
    tr.selectionSet ||
    tr.storedMarksSet ||
    tr.getMeta("focus") !== undefined ||
    tr.getMeta("blur") !== undefined
  );
}

/**
 * A version number per editor that moves when its toolbar may need to
 * re-render: at once for selection, stored-mark, focus and editable
 * changes; after {@link TOOLBAR_SETTLE_MS} of quiet for document changes,
 * or, for remote changes, {@link TOOLBAR_MAX_WAIT_MS} after the first change
 * of a burst.
 */
export function getEditorVersionStore(editor: Editor): EditorVersionStore {
  const existing = stores.get(editor);
  if (existing) return existing;

  const listeners = new Set<() => void>();
  let version = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    clearTimeout(settleTimer);
    clearTimeout(maxWaitTimer);
    settleTimer = undefined;
    maxWaitTimer = undefined;
  };
  const notify = () => {
    clearTimers();
    version += 1;
    for (const listener of listeners) listener();
  };
  const onTransaction = ({
    transaction,
    appendedTransactions,
  }: {
    transaction: Transaction;
    appendedTransactions: Transaction[];
  }) => {
    const applied = [transaction, ...appendedTransactions];
    if (applied.some((tr) => tr.docChanged)) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(notify, TOOLBAR_SETTLE_MS);
      if (applied.some(isChangeOrigin)) {
        maxWaitTimer ??= setTimeout(notify, TOOLBAR_MAX_WAIT_MS);
      }
    } else if (applied.some(changesToolbarContext)) {
      notify();
    }
  };
  // `update` also follows every document change, which `onTransaction`
  // handles; on its own, it reports `setEditable`, which dispatches nothing.
  const onUpdate = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) notify();
  };

  // A destroyed editor must never notify: the settle or max-wait timer of
  // its last burst would re-render controls of a dead editor (spec §7).
  editor.on("destroy", clearTimers);

  const store: EditorVersionStore = {
    subscribe(listener) {
      if (listeners.size === 0) {
        editor.on("transaction", onTransaction);
        editor.on("update", onUpdate);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        editor.off("transaction", onTransaction);
        editor.off("update", onUpdate);
        clearTimers();
      };
    },
    getVersion: () => version,
  };
  stores.set(editor, store);
  return store;
}

const noopSubscribe = () => () => {};
const getNoVersion = () => 0;

/**
 * Hook that provides access to a Tiptap editor instance and re-renders the
 * calling toolbar control when its state may have changed (see
 * {@link getEditorVersionStore}).
 *
 * Accepts an optional editor instance directly, or falls back to retrieving
 * the editor from the Tiptap context if available. This allows components
 * to work both when given an editor directly and when used within a Tiptap
 * editor context.
 *
 * @param providedEditor - Optional editor instance to use instead of the context editor
 * @returns The provided editor or the editor from context, whichever is available
 */
export function useTiptapEditor(providedEditor?: Editor | null): {
  editor: Editor | null;
} {
  const { editor: coreEditor } = useCurrentEditor();
  const editor = providedEditor || coreEditor || null;
  const store = editor ? getEditorVersionStore(editor) : null;
  useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getVersion ?? getNoVersion,
    getNoVersion,
  );
  return { editor };
}
