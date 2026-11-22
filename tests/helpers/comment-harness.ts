/**
 * A headless comments client for the anchor fuzz and convergence tests
 * (comments design §3, §10): a ProseMirror state written into a Y.Doc
 * with `updateYFragment`, the way the sync plugin does, plus the real
 * store, tracker and re-anchor logic. No editor view, so thousands of
 * cases run in seconds.
 */
import { getSchema, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import {
  initProseMirrorDoc,
  updateYFragment,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { COMMENTS_DEPS } from "@/extensions/comments/comments-deps";
import { TitleDocument } from "@/extensions/title-document";
import {
  type CommentRange,
  createAnchorPair,
  resolveAnchors,
} from "@/lib/comments/anchors";
import type { AnchorBinding } from "@/lib/comments/deps";
import type { CommentLimits } from "@/lib/comments/limits";
import {
  type Anchors,
  type Author,
  anchorKey,
  type Id,
} from "@/lib/comments/model";
import {
  createRangeTracker,
  type RangeTracker,
  reanchor,
} from "@/lib/comments/reanchor";
import { quoteOf } from "@/lib/comments/selection";
import { type CommentStore, createCommentStore } from "@/lib/comments/store";

export const FIELD = "default";

let schema: Schema | null = null;
export function harnessSchema(): Schema {
  schema ??= getSchema([
    StarterKit.configure({
      document: false,
      undoRedo: false,
      link: false,
      code: false,
      trailingNode: false,
    }),
    TitleDocument,
  ]);
  return schema;
}

export const testAuthor = (id = "A".repeat(22)): Author => ({
  id,
  n: "Calm Otter",
  k: "#64B5F6",
});

/** Unlimited rates and a fixed clock, so random histories never stall. */
const OPEN_RATES = {
  threads: Number.POSITIVE_INFINITY,
  messages: Number.POSITIVE_INFINITY,
};

export interface HarnessClient {
  doc: Y.Doc;
  fragment: Y.XmlFragment;
  state: EditorState;
  store: CommentStore;
  tracker: RangeTracker;
  undo: Y.UndoManager;
  binding(): AnchorBinding;
  /** Applies a local transaction, writes Yjs, then re-anchors. */
  apply(tr: Transaction): void;
  /** Rebuilds the state from Yjs (after remote updates or undo). */
  reload(): void;
  /** Resolves every thread's anchors against the current state. */
  resolve(tid: Id): CommentRange | null;
  createThread(range: CommentRange, body?: string): Id | null;
  /** Re-resolves every tracked range from Yjs, as on open. */
  refreshRanges(): void;
}

export interface HarnessOptions {
  doc?: Y.Doc;
  content?: JSONContent;
  canComment?: () => boolean;
  canManageAll?: () => boolean;
  author?: Author;
  rates?: { threads: number; messages: number };
  limits?: CommentLimits;
  now?: () => number;
}

export function createHarnessClient(
  options: HarnessOptions = {},
): HarnessClient {
  const s = harnessSchema();
  const doc = options.doc ?? new Y.Doc();
  const fragment = doc.getXmlFragment(FIELD);
  let meta = initProseMirrorDoc(fragment, s).meta;
  let state: EditorState;
  if (fragment.length === 0) {
    const pmDoc = s.nodeFromJSON(
      options.content ?? {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "alpha beta gamma" }],
          },
        ],
      },
    );
    doc.transact(
      () => updateYFragment(doc, fragment, pmDoc, meta),
      ySyncPluginKey,
    );
    state = EditorState.create({ schema: s, doc: pmDoc });
  } else {
    const init = initProseMirrorDoc(fragment, s);
    meta = init.meta;
    state = EditorState.create({ schema: s, doc: init.doc });
  }
  const undo = new Y.UndoManager(fragment, {
    trackedOrigins: new Set([ySyncPluginKey]),
    captureTimeout: 0,
  });
  const author = options.author ?? testAuthor();
  const store = createCommentStore({
    doc,
    canComment: options.canComment ?? (() => true),
    canManageAll: options.canManageAll ?? (() => true),
    author: () => author,
    now: options.now ?? (() => Date.UTC(2026, 10, 16)),
    rates: options.rates ?? OPEN_RATES,
    limits: options.limits,
  });
  const tracker = createRangeTracker(COMMENTS_DEPS);
  const binding = (): AnchorBinding => ({
    doc,
    type: fragment,
    mapping: meta.mapping,
  });

  const client: HarnessClient = {
    doc,
    fragment,
    get state() {
      return state;
    },
    store,
    tracker,
    undo,
    binding,
    apply(tr) {
      state = state.apply(tr);
      doc.transact(
        () => updateYFragment(doc, fragment, state.doc, meta),
        ySyncPluginKey,
      );
      undo.stopCapturing();
      tracker.local(tr);
      reanchor(
        COMMENTS_DEPS,
        binding(),
        state.doc,
        store,
        tracker,
        tracker.takePending(),
      );
    },
    reload() {
      const init = initProseMirrorDoc(fragment, s);
      meta = init.meta;
      state = EditorState.create({ schema: s, doc: init.doc });
    },
    resolve(tid) {
      const anchors = store.map.get(anchorKey(tid)) as Anchors | undefined;
      return anchors ? resolveAnchors(COMMENTS_DEPS, binding(), anchors) : null;
    },
    createThread(range, body = "A note") {
      const anchors = createAnchorPair(COMMENTS_DEPS, binding(), range);
      if (!anchors) return null;
      const result = store.create({
        anchors,
        quote: quoteOf(state.doc, range),
        body,
      });
      if (!result.ok) return null;
      tracker.ranges.set(result.tid, range);
      return result.tid;
    },
    refreshRanges() {
      tracker.ranges.clear();
      for (const key of store.map.keys()) {
        if (!key.startsWith("t:")) continue;
        const tid = key.slice(2);
        const range = client.resolve(tid);
        if (range) tracker.ranges.set(tid, range);
      }
    },
  };
  return client;
}
