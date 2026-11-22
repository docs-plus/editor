/**
 * Dev-only Playwright hooks for the comments typing case (comments design
 * §8, "Typing"; `tests/e2e/performance.spec.ts`). Comments are dark, so
 * nothing on the web mounts them; a test that set `window.__COMMENTS_PERF`
 * before boot gets them mounted here, and `window.__comments` to load the
 * controller and seed threads. Production builds never reach this module:
 * its only import is a dynamic one behind a `NODE_ENV` check.
 */
import type { Editor } from "@tiptap/core";
import type * as Y from "yjs";

import { COMMENTS_DEPS } from "@/extensions/comments/comments-deps";
import { mountComments } from "@/extensions/comments/comments-loader";
import { type CommentRange, createAnchorPair } from "@/lib/comments/anchors";
import { quoteOf } from "@/lib/comments/selection";
import { createCommentStore } from "@/lib/comments/store";

/** Five characters at the start of each paragraph, until `count`. */
function threadRanges(editor: Editor, count: number): CommentRange[] {
  const ranges: CommentRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (ranges.length >= count) return false;
    if (node.type.name === "paragraph" && node.textContent.length >= 5) {
      ranges.push({ from: pos + 1, to: pos + 6 });
    }
    return !node.isTextblock;
  });
  return ranges;
}

/** Writes up to `count` threads without the honest-client rates. */
function seedThreads(editor: Editor, doc: Y.Doc, count: number): number {
  const binding = COMMENTS_DEPS.syncBinding(editor.state);
  if (!binding) return 0;
  const store = createCommentStore({
    doc,
    canComment: () => true,
    author: () => ({ id: "P".repeat(22), n: "Perf", k: "#64B5F6" }),
    rates: {
      threads: Number.POSITIVE_INFINITY,
      messages: Number.POSITIVE_INFINITY,
    },
  });
  let made = 0;
  for (const range of threadRanges(editor, count)) {
    const anchors = createAnchorPair(COMMENTS_DEPS, binding, range);
    if (!anchors) continue;
    const quote = quoteOf(editor.state.doc, range);
    if (store.create({ anchors, quote, body: "Perf thread" }).ok) made++;
  }
  return made;
}

/** Mounts comments on `editor` for a test; returns the unmount. */
export function mountCommentsForTests(editor: Editor, doc: Y.Doc): () => void {
  const mounted = mountComments(editor, {
    doc,
    lineage: "00000000-0000-4000-8000-000000000000",
    canComment: () => true,
  });
  window.__comments = {
    ready: async () => (await mounted.controller()) !== null,
    seed: (count) => seedThreads(editor, doc, count),
  };
  return () => {
    mounted.unmount();
    delete window.__comments;
  };
}
