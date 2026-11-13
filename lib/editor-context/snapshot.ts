import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

import type { ContextKind, Ctx } from "@/lib/editor-actions/types";

/**
 * Builds the selection snapshot (spec §2). SKELETON: PR D1 replaces this
 * body with the full O(depth) walk and the kind precedence pinned by
 * `CONTEXT_KINDS`; the signature and the `Ctx` shape are the contract.
 */
export function computeContext(editor: Editor): Ctx {
  const { state } = editor;
  const { selection } = state;
  const { $head } = selection;
  const parent = $head.parent;
  const editable = editor.isEditable;
  const isHeading = parent.type.name === "heading";
  const kind: ContextKind = !editable
    ? "readonly"
    : isHeading
      ? "heading"
      : "paragraph";
  const memo = new Map<string, unknown>();
  return {
    kind,
    state,
    editable,
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
      if (!memo.has(key)) memo.set(key, compute());
      return memo.get(key) as T;
    },
  };
}
