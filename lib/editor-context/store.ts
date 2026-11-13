import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

import { getEditorVersionStore } from "@/hooks/use-tiptap-editor";
import { editorActions } from "@/lib/editor-actions";
import { availability } from "@/lib/editor-actions/registry";
import type { ActionView, Ctx, Enabled } from "@/lib/editor-actions/types";
import { computeContext } from "@/lib/editor-context/snapshot";

/**
 * Per-editor context store (spec §2, §4.2). Wraps `getEditorVersionStore`
 * (same version, same timing: immediate for selection, settled for doc
 * changes, `TOOLBAR_MAX_WAIT_MS` cap for remote changes only).
 * Contract deviation from the spec text: the API lives here, not on the
 * version store itself, so `hooks/use-tiptap-editor.ts` stays unchanged.
 * SKELETON: PR D1 owns and may rewrite the body; the API and the freshness,
 * caching and notify rules below are the contract (pinned by the test).
 */
export interface EditorContextStore {
  /** Own listener set; wraps the version store and adds hold-release notifies. */
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  /**
   * Live snapshot. While subscribed: memoized by store version (lags doc
   * changes by the settle window, by design). With no subscriber the version
   * does not move, so it is memoized by `(editor.state, editor.isEditable)`
   * instead and is never stale (palette on open, `hold()` before mount,
   * `__TOOLBAR_OFF`).
   */
  getContext(): Ctx;
  /**
   * Snapshot that drives the context slot's *contents*: frozen while any
   * `hold()` is open, otherwise the live snapshot. Enabled states keep
   * updating through `getView`.
   */
  getSlotContext(): Ctx;
  /**
   * Computed once per snapshot (cached by `getContext()` identity), so the
   * repeated `getSnapshot` calls of `useSyncExternalStore` cost a map read.
   * Same object while its fields are unchanged; null for an unknown id.
   */
  getView(id: string): ActionView | null;
  /**
   * Freezes slot contents while focus is in the toolbar. Ref-counted; the
   * returned release is idempotent and must also run on unmount. The final
   * release notifies subscribers when the slot snapshot changed.
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

interface CachedContext {
  /** Subscription epoch; bumps when the first listener arrives. */
  epoch: number;
  version: number;
  state: EditorState;
  editable: boolean;
  ctx: Ctx;
}

export function getEditorContextStore(editor: Editor): EditorContextStore {
  const existing = stores.get(editor);
  if (existing) return existing;

  const versions = getEditorVersionStore(editor);
  const listeners = new Set<() => void>();
  let stopVersions: (() => void) | null = null;
  let epoch = 0;
  let cached: CachedContext | null = null;
  let held: Ctx | null = null;
  let holds = 0;
  const views = new Map<string, { ctx: Ctx; view: ActionView }>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const isFresh = (entry: CachedContext): boolean =>
    listeners.size > 0
      ? entry.epoch === epoch && entry.version === versions.getVersion()
      : entry.state === editor.state && entry.editable === editor.isEditable;

  const getContext = (): Ctx => {
    if (cached && isFresh(cached)) return cached.ctx;
    cached = {
      epoch,
      version: versions.getVersion(),
      state: editor.state,
      editable: editor.isEditable,
      ctx: computeContext(editor),
    };
    return cached.ctx;
  };

  const store: EditorContextStore = {
    subscribe(listener) {
      if (listeners.size === 0) {
        // The version did not move while unsubscribed; never trust a
        // version-keyed entry from before.
        epoch += 1;
        stopVersions = versions.subscribe(notify);
      }
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        stopVersions?.();
        stopVersions = null;
      };
    },
    getVersion: versions.getVersion,
    getContext,
    getSlotContext: () => held ?? getContext(),
    getView(id) {
      const action = editorActions.get(id);
      if (!action) return null;
      const ctx = getContext();
      const previous = views.get(id);
      if (previous?.ctx === ctx) return previous.view;
      const next: ActionView = {
        id,
        enabled: availability(action, ctx),
        active: action.isActive?.(ctx) ?? false,
        mixed: action.isMixed?.(ctx) ?? false,
        value: action.value?.(ctx) ?? null,
      };
      const view =
        previous && sameView(previous.view, next) ? previous.view : next;
      views.set(id, { ctx, view });
      return view;
    },
    hold() {
      if (holds === 0) held = getContext();
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds > 0) return;
        const frozen = held;
        held = null;
        if (frozen !== getContext()) notify();
      };
    },
  };
  stores.set(editor, store);
  return store;
}
