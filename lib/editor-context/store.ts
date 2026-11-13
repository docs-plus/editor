import type { Editor } from "@tiptap/core";

import { getEditorVersionStore } from "@/hooks/use-tiptap-editor";
import { editorActions } from "@/lib/editor-actions";
import { isOfferedIn } from "@/lib/editor-actions/registry";
import type { ActionView, Ctx, Enabled } from "@/lib/editor-actions/types";
import { computeContext } from "@/lib/editor-context/snapshot";

/**
 * Per-editor context store (spec §2, §4.2). Wraps `getEditorVersionStore`
 * (same version, same timing: immediate for selection, settled for doc
 * changes, `TOOLBAR_MAX_WAIT_MS` cap) and memoizes by its version.
 * Contract deviation from the spec text: the API lives here, not on the
 * version store itself, so `hooks/use-tiptap-editor.ts` stays unchanged.
 * SKELETON: PR D1 owns and may rewrite the body; the API is the contract.
 */
export interface EditorContextStore {
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  /** Live snapshot, memoized by version. */
  getContext(): Ctx;
  /**
   * Snapshot that drives the context slot's *contents*: frozen while any
   * `hold()` is open, otherwise the live snapshot. Enabled states keep
   * updating through `getView`.
   */
  getSlotContext(): Ctx;
  /** Same object while its fields are unchanged; null for an unknown id. */
  getView(id: string): ActionView | null;
  /**
   * Freezes slot contents while focus is in the toolbar. Ref-counted; the
   * returned release is idempotent and must also run on unmount.
   */
  hold(): () => void;
}

const stores = new WeakMap<Editor, EditorContextStore>();

const sameEnabled = (a: Enabled, b: Enabled) =>
  a === true || b === true ? a === b : a.reason === b.reason;

const sameView = (a: ActionView, b: ActionView) =>
  a.active === b.active &&
  a.mixed === b.mixed &&
  a.value === b.value &&
  sameEnabled(a.enabled, b.enabled);

const OFFERED_ELSEWHERE: Enabled = { reason: "Not available here" };

export function getEditorContextStore(editor: Editor): EditorContextStore {
  const existing = stores.get(editor);
  if (existing) return existing;

  const versions = getEditorVersionStore(editor);
  let cached: { version: number; ctx: Ctx } | null = null;
  let held: Ctx | null = null;
  let holds = 0;
  const views = new Map<string, ActionView>();

  const getContext = (): Ctx => {
    const version = versions.getVersion();
    if (cached?.version !== version) {
      cached = { version, ctx: computeContext(editor) };
    }
    return cached.ctx;
  };

  const store: EditorContextStore = {
    subscribe: versions.subscribe,
    getVersion: versions.getVersion,
    getContext,
    getSlotContext: () => held ?? getContext(),
    getView(id) {
      const action = editorActions.get(id);
      if (!action) return null;
      const ctx = getContext();
      const next: ActionView = {
        id,
        enabled: isOfferedIn(action, ctx.kind)
          ? action.enabled(ctx)
          : OFFERED_ELSEWHERE,
        active: action.isActive?.(ctx) ?? false,
        mixed: action.isMixed?.(ctx) ?? false,
        value: action.value?.(ctx) ?? null,
      };
      const previous = views.get(id);
      if (previous && sameView(previous, next)) return previous;
      views.set(id, next);
      return next;
    },
    hold() {
      if (holds === 0) held = getContext();
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds === 0) held = null;
      };
    },
  };
  stores.set(editor, store);
  return store;
}
