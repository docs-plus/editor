import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

import type { ContextKind, Ctx } from "@/lib/editor-actions/types";

/** The HyperMultimedia kit's node types (`MediaNodeType`). */
export const MEDIA_NODE_TYPES: ReadonlySet<string> = new Set([
  "image",
  "video",
  "audio",
  "youtube",
  "vimeo",
  "soundcloud",
  "spotify",
  "loom",
  "x",
]);

/** The Mermaid extension stores diagrams as code blocks in this language. */
export const MERMAID_LANGUAGE = "mermaid";

const LIST_NODES = new Set([
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
]);

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
 * Mark names on every text node of the selection, or the stored marks (else
 * the marks at the caret) for an empty selection. O(range) for a range, so
 * `Ctx.activeMarks` computes it lazily.
 */
function marksAcrossSelection(state: EditorState): ReadonlySet<string> {
  const { selection, storedMarks, doc } = state;
  if (selection.empty) {
    return new Set(
      (storedMarks ?? selection.$head.marks()).map((mark) => mark.type.name),
    );
  }
  let common: Set<string> | null = null;
  for (const range of selection.ranges) {
    doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (!node.isText) return true;
      const names = node.marks.map((mark) => mark.type.name);
      common = common
        ? new Set(names.filter((name) => common?.has(name)))
        : new Set(names);
      return false;
    });
  }
  return common ?? new Set<string>();
}

interface Structure {
  inTable: boolean;
  inList: boolean;
  inBlockquote: boolean;
  inCodeBlock: boolean;
  codeLanguage: string | null;
}

/** One walk from the head up to the doc: O(depth). */
function walkAncestors(state: EditorState): Structure {
  const { $head } = state.selection;
  const found: Structure = {
    inTable: state.selection instanceof CellSelection,
    inList: false,
    inBlockquote: false,
    inCodeBlock: false,
    codeLanguage: null,
  };
  for (let depth = $head.depth; depth > 0; depth -= 1) {
    const node = $head.node(depth);
    const name = node.type.name;
    if (name === "table") found.inTable = true;
    else if (name === "blockquote") found.inBlockquote = true;
    else if (LIST_NODES.has(name)) found.inList = true;
    else if (name === "codeBlock" && !found.inCodeBlock) {
      found.inCodeBlock = true;
      found.codeLanguage = (node.attrs.language as string | null) ?? null;
    }
  }
  return found;
}

function kindOf(
  structure: Structure,
  nodeSelectionType: string | null,
  isTitle: boolean,
  isHeading: boolean,
): ContextKind {
  if (nodeSelectionType && MEDIA_NODE_TYPES.has(nodeSelectionType)) {
    return "media";
  }
  if (structure.inCodeBlock) {
    return structure.codeLanguage === MERMAID_LANGUAGE ? "mermaid" : "code";
  }
  if (structure.inTable) return "table";
  if (isTitle) return "title";
  if (isHeading) return "heading";
  if (structure.inList) return "list";
  return "paragraph";
}

/**
 * Builds the selection snapshot (spec §2): one O(depth) walk, `kind` by the
 * precedence of `CONTEXT_KINDS`. `kind` is structural; read-only is
 * `editable`, gated centrally by `availability()`.
 */
export function computeContext(editor: Editor): Ctx {
  const { state } = editor;
  const { selection, doc } = state;
  const { $head } = selection;
  const nodeSelectionType =
    selection instanceof NodeSelection ? selection.node.type.name : null;
  // A NodeSelection's own node is the "block" for heading purposes.
  const block =
    selection instanceof NodeSelection ? selection.node : $head.parent;
  const isHeading = block.type.name === "heading";
  const isTitle = $head.depth >= 1 && $head.index(0) === 0 && isHeading;
  const structure = walkAncestors(state);
  const kind = kindOf(structure, nodeSelectionType, isTitle, isHeading);

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
    parentType: $head.parent.type.name,
    inTable: structure.inTable,
    inList: structure.inList,
    inBlockquote: structure.inBlockquote,
    inCodeBlock: structure.inCodeBlock,
    isTitle,
    nodeSelectionType,
    headingLevel: isHeading ? (block.attrs.level as number) : null,
    headingId: isHeading ? ((block.attrs.id as string | null) ?? null) : null,
    get activeMarks() {
      return memoIn(memo, "activeMarks", () => marksAcrossSelection(state));
    },
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

/** The code block's language at the head, if any (code and Mermaid kinds). */
export function codeLanguageAt(ctx: Ctx): string | null {
  return ctx.memo("codeLanguage", () => walkAncestors(ctx.state).codeLanguage);
}
