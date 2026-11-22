/**
 * The comments core on a live editor (comments design §5, §8): the lazy
 * chunk's entry. One controller per document session. It keeps each
 * thread's range, re-anchors after local structural edits, re-resolves
 * after remote ones and comment changes, and draws open threads in the
 * decoration host's `comments` layer. Never `registerPlugin` (it would
 * re-create every plugin view): it listens with `editor.on` and
 * `Y.Map.observe`, and every listener, timer and frame goes on destroy.
 *
 * Imports from the editor chunk are types only; what it needs at runtime
 * comes in `deps` (contract A16).
 */
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import type * as Y from "yjs";

// Types only: the `setDecorationLayer` command's declaration.
import type {} from "@/extensions/decoration-host/decoration-host";
import {
  anchorsOnlyLiveHere,
  type CommentRange,
  createAnchorPair,
  resolveAnchors,
  sameRange,
} from "@/lib/comments/anchors";
import { getAuthorId } from "@/lib/comments/author-id";
import { cleanAuthorName } from "@/lib/comments/clean";
import type { CommentsDeps } from "@/lib/comments/deps";
import {
  type Anchors,
  type Author,
  anchorKey,
  type CommentValue,
  type Id,
  parseKey,
  type Status,
  statusKey,
  threadKey,
} from "@/lib/comments/model";
import {
  createRangeTracker,
  type RangeTracker,
  reanchor,
  refreshAnchors,
} from "@/lib/comments/reanchor";
import { commentRangeFor, quoteOf } from "@/lib/comments/selection";
import {
  type CommentResult,
  type CommentStore,
  createCommentStore,
} from "@/lib/comments/store";
import { readThreads, type Thread } from "@/lib/comments/threads";

/** The decoration host layer comments draw in (document-editor-config). */
export const COMMENTS_LAYER = "comments";
/** A thread shows Detached only after its anchor has failed this long. */
export const DETACHED_AFTER_MS = 1_500;
/** Threads resolved per idle slice when a document opens (§8). */
export const OPEN_SLICE = 50;

export interface CommentsControllerOptions {
  editor: Editor;
  /** The Y.Doc the editor's sync plugin is bound to. */
  doc: Y.Doc;
  deps: CommentsDeps;
  canComment: () => boolean;
  canManageAll?: () => boolean;
  /**
   * This window's name and colour (`getUserIdentity()`), read at each
   * write; the colour is always a palette entry. `id` defaults to this
   * browser's author id (`lib/comments/author-id.ts`).
   */
  identity: () => CommentIdentity;
  /** Defaults to `requestAnimationFrame`; tests drive `flush()` instead. */
  schedule?: (run: () => void) => () => void;
  /** Defaults to `requestIdleCallback` (or a timeout). */
  idle?: (run: () => void) => () => void;
  now?: () => number;
}

export interface CommentIdentity {
  id?: Id;
  name: string;
  color: string;
}

/** The author comments store: the name cleaned and cut to 40 (§4.2). */
export function authorOf({ id, name, color }: CommentIdentity): Author {
  return {
    id: id ?? getAuthorId(),
    n: cleanAuthorName(name) || "Anonymous",
    k: color as Author["k"],
  };
}

export interface CommentsSnapshot {
  threads: readonly Thread[];
  /** Each thread's current range (live: read it when drawing). */
  ranges: ReadonlyMap<Id, CommentRange>;
  /** Threads whose anchor has failed for `DETACHED_AFTER_MS`. */
  detached: ReadonlySet<Id>;
}

export interface CommentsController {
  readonly store: CommentStore;
  /** A new thread on the selection (or the word at the caret). */
  createFromSelection(body: string): CommentResult<{ tid: Id }>;
  /** Re-attach to selection (§11.8): new anchors, the old pair kept. */
  reattach(tid: Id): CommentResult;
  getSnapshot(): CommentsSnapshot;
  subscribe(listener: () => void): () => void;
  /** Runs the pending frame now (tests, and before reading positions). */
  flush(): void;
  destroy(): void;
}

function frame(run: () => void): () => void {
  const id = requestAnimationFrame(run);
  return () => cancelAnimationFrame(id);
}

/** An idle slice runs within this long even on a busy main thread. */
export const IDLE_TIMEOUT_MS = 500;

function idleSlice(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 16);
  return () => clearTimeout(id);
}

export function attachComments({
  editor,
  doc,
  deps,
  canComment,
  canManageAll,
  identity,
  schedule = frame,
  idle = idleSlice,
  now = Date.now,
}: CommentsControllerOptions): CommentsController {
  const store = createCommentStore({
    doc,
    canComment,
    canManageAll,
    author: () => authorOf(identity()),
    now,
  });
  const tracker: RangeTracker = createRangeTracker(deps);
  /** Threads to resolve from Yjs in the next frame. */
  const toResolve = new Set<Id>();
  /** When each failing anchor started failing. */
  const failingSince = new Map<Id, number>();
  const detached = new Set<Id>();
  const listeners = new Set<() => void>();
  let snapshot: CommentsSnapshot | null = null;
  let cancelFrame: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;
  let detachTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  /** The comments map changed since the last frame. */
  let commentsChanged = false;
  /** A re-anchor is queued as a microtask (see `onTransaction`). */
  let reanchorQueued = false;
  /** Threads still to resolve on open, parked until the binding exists. */
  let awaitingBinding: Id[] | null = null;

  const binding = () => deps.syncBinding(editor.state);

  function queueReanchor() {
    if (reanchorQueued) return;
    reanchorQueued = true;
    queueMicrotask(runReanchor);
  }

  function notify() {
    snapshot = null;
    for (const listener of listeners) listener();
  }

  function isOpen(tid: Id): boolean {
    return !(store.map.get(statusKey(tid)) as Status | undefined)?.r;
  }

  /** Redraws the layer; an editor without the host draws nothing. */
  function draw() {
    if (editor.isDestroyed) return;
    const { doc: pmDoc } = editor.state;
    const size = pmDoc.content.size;
    const decorations = [];
    for (const [tid, { from, to }] of tracker.ranges) {
      if (detached.has(tid) || !isOpen(tid) || to > size) continue;
      decorations.push(
        deps.inlineDecoration(from, to, {
          class: "comment-range",
          "data-comment-thread": tid,
        }),
      );
    }
    editor.commands.setDecorationLayer?.(
      COMMENTS_LAYER,
      deps.createDecorationSet(pmDoc, decorations),
    );
  }

  function armDetachTimer() {
    if (detachTimer || !failingSince.size) return;
    detachTimer = setTimeout(() => {
      detachTimer = null;
      if (destroyed) return;
      let changed = false;
      const at = now();
      for (const [tid, since] of failingSince) {
        if (at - since >= DETACHED_AFTER_MS && !detached.has(tid)) {
          detached.add(tid);
          changed = true;
        }
      }
      armDetachTimer();
      if (changed) notify();
    }, DETACHED_AFTER_MS);
  }

  /** Resolves `tids` from Yjs; returns whether any range changed. */
  function resolve(tids: Iterable<Id>): boolean {
    const current = binding();
    if (!current) return false;
    let changed = false;
    /** Threads only this client can resolve, after its undo or redo. */
    const onlyHere: Id[] = [];
    for (const tid of tids) {
      const anchors = store.map.get(anchorKey(tid)) as Anchors | undefined;
      const range = anchors ? resolveAnchors(deps, current, anchors) : null;
      if (!store.map.has(threadKey(tid))) {
        changed = tracker.ranges.delete(tid) || changed;
        failingSince.delete(tid);
        detached.delete(tid);
        continue;
      }
      if (range) {
        if (!sameRange(tracker.ranges.get(tid), range)) changed = true;
        tracker.ranges.set(tid, range);
        failingSince.delete(tid);
        if (detached.delete(tid)) changed = true;
        if (anchors && anchorsOnlyLiveHere(deps, current.doc, anchors)) {
          onlyHere.push(tid);
        }
      } else {
        changed = tracker.ranges.delete(tid) || changed;
        if (!failingSince.has(tid)) failingSince.set(tid, now());
      }
    }
    if (onlyHere.length && canComment()) {
      refreshAnchors(deps, current, store, onlyHere);
    }
    armDetachTimer();
    return changed;
  }

  /**
   * The re-anchor after local structural edits (§5.3). It runs in a
   * microtask, never a frame: the ranges it reads must still be the local
   * transaction's mapping, and a collaborator's update (its own task, a
   * WebSocket message) would map them through a whole-span replace first.
   * A frame also never comes in a hidden tab. A thread it skips has its
   * text deleted here; its anchor stays for undo, so nothing is retried.
   */
  function runReanchor() {
    reanchorQueued = false;
    if (destroyed || editor.isDestroyed) return;
    const pending = tracker.takePending();
    if (!pending.size) return;
    const current = binding();
    if (current && canComment()) {
      reanchor(deps, current, editor.state.doc, store, tracker, pending);
    }
    for (const tid of pending) toResolve.add(tid);
    requestFrame();
  }

  function runFrame() {
    cancelFrame = null;
    if (destroyed || editor.isDestroyed) return;
    const tids = [...toResolve];
    toResolve.clear();
    // Mapping alone moved the ranges; the layer mapped its set the same way.
    const moved = resolve(tids);
    if (moved || commentsChanged) draw();
    // Typing that only maps ranges notifies nobody (no per-keystroke work).
    if (moved || commentsChanged) notify();
    commentsChanged = false;
  }

  function requestFrame() {
    if (!cancelFrame && !destroyed) cancelFrame = schedule(runFrame);
  }

  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (awaitingBinding && binding()) {
      const rest = awaitingBinding;
      awaitingBinding = null;
      resolveOnOpen(rest);
    }
    if (!transaction.docChanged) return;
    if (deps.isChangeOrigin(transaction)) {
      // Never re-anchor from a remote change: its mapping is one replace
      // over the changed span and would invent positions (§5.3).
      for (const tid of tracker.remote(transaction)) toResolve.add(tid);
      // Undo can bring back the text of a thread that has no range, without
      // touching the comments map. Usually there is none.
      for (const tid of failingSince.keys()) toResolve.add(tid);
    } else {
      tracker.local(transaction);
      // The sync plugin has written Yjs by now (Tiptap emits `transaction`
      // after the view update).
      if (tracker.ranges.size) queueReanchor();
    }
    requestFrame();
  };

  const onComments = (event: Y.YMapEvent<CommentValue>) => {
    commentsChanged = true;
    for (const key of event.keysChanged) {
      const parsed = parseKey(key);
      if (parsed) toResolve.add(parsed.tid);
    }
    requestFrame();
  };

  /** First resolution, in idle slices of `OPEN_SLICE` threads (§8). */
  function resolveOnOpen(rest: Id[]) {
    cancelIdle = null;
    if (destroyed || !rest.length) return;
    if (!binding()) {
      // The sync plugin sets its binding with a transaction: wait for it.
      awaitingBinding = rest;
      return;
    }
    if (resolve(rest.slice(0, OPEN_SLICE))) draw();
    notify();
    const next = rest.slice(OPEN_SLICE);
    if (next.length) cancelIdle = idle(() => resolveOnOpen(next));
  }

  editor.on("transaction", onTransaction);
  store.map.observe(onComments);
  const heads: Id[] = [];
  for (const key of store.map.keys()) {
    if (key.startsWith("t:")) heads.push(key.slice(2));
  }
  resolveOnOpen(heads);

  return {
    store,

    createFromSelection(body) {
      const current = binding();
      const { doc: pmDoc, selection } = editor.state;
      const range = commentRangeFor(pmDoc, selection.from, selection.to);
      if (!range) return { ok: false, reason: "empty" };
      const anchors = current && createAnchorPair(deps, current, range);
      if (!anchors) return { ok: false, reason: "empty" };
      const result = store.create({
        anchors,
        quote: quoteOf(pmDoc, range),
        body,
      });
      if (result.ok) {
        tracker.ranges.set(result.tid, range);
        draw();
      }
      return result;
    },

    reattach(tid) {
      const current = binding();
      const { doc: pmDoc, selection } = editor.state;
      const range =
        selection.from < selection.to
          ? commentRangeFor(pmDoc, selection.from, selection.to)
          : null;
      const anchors =
        range && current && createAnchorPair(deps, current, range);
      if (!range || !anchors) return { ok: false, reason: "empty" };
      const result = store.setAnchors(tid, anchors, "reattach");
      if (result.ok) {
        tracker.ranges.set(tid, range);
        failingSince.delete(tid);
        detached.delete(tid);
        draw();
      }
      return result;
    },

    getSnapshot() {
      snapshot ??= {
        threads: readThreads(store.map),
        ranges: tracker.ranges,
        detached: new Set(detached),
      };
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    flush() {
      if (reanchorQueued) runReanchor();
      if (!cancelFrame) return;
      cancelFrame();
      runFrame();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor.off("transaction", onTransaction);
      store.map.unobserve(onComments);
      cancelFrame?.();
      cancelIdle?.();
      if (detachTimer) clearTimeout(detachTimer);
      listeners.clear();
      if (!editor.isDestroyed) {
        editor.commands.setDecorationLayer?.(
          COMMENTS_LAYER,
          deps.createDecorationSet(editor.state.doc, []),
        );
      }
    },
  };
}
