import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";

import type { ContextKind, Ctx } from "@/lib/editor-actions/types";

/** `Ctx.docMemo` storage: one map per `state.doc`, dropped with the doc. */
const docMemos = new WeakMap<ProseMirrorNode, Map<string, unknown>>();

function memoIn<T>(
  cache: Map<string, unknown>,
  key: string,
  compute: () => T,
): T {
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key) as T;
}

/**
 * Builds the selection snapshot (spec §2). SKELETON: PR D1 replaces the
 * kind/flags walk with the full O(depth) walk and the precedence pinned by
 * `CONTEXT_KINDS`; the signature, the `Ctx` shape and the two cache tiers
 * (`memo`/`can` per snapshot, `docMemo` per `state.doc`) are the contract.
 */
export function computeContext(editor: Editor): Ctx {
  const { state } = editor;
  const { selection, doc } = state;
  const { $head } = selection;
  const parent = $head.parent;
  const isHeading = parent.type.name === "heading";
  const kind: ContextKind = isHeading ? "heading" : "paragraph";
  const memo = new Map<string, unknown>();
  let docMemo = docMemos.get(doc);
  if (!docMemo) {
    docMemo = new Map();
    docMemos.set(doc, docMemo);
  }
  const docCache = docMemo;
  return {
    kind,
    state,
    editable: editor.isEditable,
    empty: selection.empty,
    parentType: parent.type.name,
    inTable: false,
    inList: false,
    inBlockquote: false,
    inCodeBlock: parent.type.name === "codeBlock",
    isTitle: isHeading && $head.depth === 1 && $head.index(0) === 0,
    nodeSelectionType:
      selection instanceof NodeSelection ? selection.node.type.name : null,
    headingLevel: isHeading ? (parent.attrs.level as number) : null,
    headingId: isHeading ? ((parent.attrs.id as string | null) ?? null) : null,
    activeMarks: new Set(
      (state.storedMarks ?? $head.marks()).map((mark) => mark.type.name),
    ),
    memo<T>(key: string, compute: () => T): T {
      return memoIn(memo, key, compute);
    },
    docMemo<T>(key: string, compute: () => T): T {
      return memoIn(docCache, key, compute);
    },
    can(key, check) {
      return memoIn(memo, `can:${key}`, () => check(editor));
    },
  };
}
