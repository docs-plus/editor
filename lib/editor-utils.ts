import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import {
  AllSelection,
  NodeSelection,
  Selection,
  TextSelection,
} from "@tiptap/pm/state";
import { CellSelection, cellAround } from "@tiptap/pm/tables";
import {
  type Editor,
  findParentNodeClosestToPos,
  type NodeWithPos,
} from "@tiptap/react";

/**
 * Checks if a mark exists in the editor schema
 */
export const isMarkInSchema = (
  markName: string,
  editor: Editor | null,
): boolean => {
  if (!editor?.schema) return false;
  return editor.schema.spec.marks.get(markName) !== undefined;
};

/**
 * Checks if a node exists in the editor schema
 */
export const isNodeInSchema = (
  nodeName: string,
  editor: Editor | null,
): boolean => {
  if (!editor?.schema) return false;
  return editor.schema.spec.nodes.get(nodeName) !== undefined;
};

/**
 * Moves the focus to the next node in the editor
 */
export function focusNextNode(editor: Editor) {
  const { state, view } = editor;
  const { doc, selection } = state;

  const nextSel = Selection.findFrom(selection.$to, 1, true);
  if (nextSel) {
    view.dispatch(state.tr.setSelection(nextSel).scrollIntoView());
    return true;
  }

  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) {
    console.warn("No paragraph node type found in schema.");
    return false;
  }

  const end = doc.content.size;
  const para = paragraphType.create();
  let tr = state.tr.insert(end, para);

  const $inside = tr.doc.resolve(end + 1);
  tr = tr.setSelection(TextSelection.near($inside)).scrollIntoView();
  view.dispatch(tr);
  return true;
}

/**
 * Checks if a value is a valid document position
 */
export function isValidPosition(pos: number | null | undefined): pos is number {
  return typeof pos === "number" && pos >= 0;
}

/**
 * Checks if one or more extensions are registered in the Tiptap editor.
 */
export function isExtensionAvailable(
  editor: Editor | null,
  extensionNames: string | string[],
): boolean {
  if (!editor) return false;

  const names = Array.isArray(extensionNames)
    ? extensionNames
    : [extensionNames];

  const found = names.some((name) =>
    editor.extensionManager.extensions.some((ext) => ext.name === name),
  );

  if (!found) {
    console.warn(
      `None of the extensions [${names.join(", ")}] were found in the editor schema. Ensure they are included in the editor configuration.`,
    );
  }

  return found;
}

/**
 * Finds a node at the specified position with error handling
 */
export function findNodeAtPosition(editor: Editor, position: number) {
  try {
    const node = editor.state.doc.nodeAt(position);
    if (!node) {
      console.warn(`No node found at position ${position}`);
      return null;
    }
    return node;
  } catch (error) {
    console.error(`Error getting node at position ${position}:`, error);
    return null;
  }
}

/**
 * Finds the position and instance of a node in the document
 */
export function findNodePosition(props: {
  editor: Editor | null;
  node?: PMNode | null;
  nodePos?: number | null;
}): { pos: number; node: PMNode } | null {
  const { editor, node, nodePos } = props;

  if (!editor || !editor.state?.doc) return null;

  const hasValidNode = node !== undefined && node !== null;
  const hasValidPos = isValidPosition(nodePos);

  if (!hasValidNode && !hasValidPos) {
    return null;
  }

  if (hasValidNode) {
    let foundPos = -1;
    let foundNode: PMNode | null = null;

    editor.state.doc.descendants((currentNode, pos) => {
      if (currentNode === node) {
        foundPos = pos;
        foundNode = currentNode;
        return false;
      }
      return true;
    });

    if (foundPos !== -1 && foundNode !== null) {
      return { pos: foundPos, node: foundNode };
    }
  }

  if (nodePos != null && hasValidPos) {
    const nodeAtPos = findNodeAtPosition(editor, nodePos);
    if (nodeAtPos) {
      return { pos: nodePos, node: nodeAtPos };
    }
  }

  return null;
}

/**
 * Determines whether the current selection contains a node whose type matches
 * any of the provided node type names.
 */
export function isNodeTypeSelected(
  editor: Editor | null,
  nodeTypeNames: string[] = [],
  checkAncestorNodes: boolean = false,
): boolean {
  if (!editor || !editor.state.selection) return false;

  const { selection } = editor.state;
  if (selection.empty) return false;

  if (selection instanceof NodeSelection) {
    const selectedNode = selection.node;
    return selectedNode
      ? nodeTypeNames.includes(selectedNode.type.name)
      : false;
  }

  if (checkAncestorNodes) {
    const { $from } = selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const ancestorNode = $from.node(depth);
      if (nodeTypeNames.includes(ancestorNode.type.name)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check whether the current selection is fully within nodes
 * whose type names are in the provided `types` list.
 */
export function selectionWithinConvertibleTypes(
  editor: Editor,
  types: string[] = [],
): boolean {
  if (!editor || types.length === 0) return false;

  const { state } = editor;
  const { selection } = state;
  const allowed = new Set(types);

  if (selection instanceof NodeSelection) {
    const nodeType = selection.node?.type?.name;
    return !!nodeType && allowed.has(nodeType);
  }

  if (selection instanceof TextSelection || selection instanceof AllSelection) {
    let valid = true;
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (node.isTextblock && !allowed.has(node.type.name)) {
        valid = false;
        return false;
      }
      return valid;
    });
    return valid;
  }

  return false;
}

/**
 * Update a single attribute on multiple nodes.
 */
export function updateNodesAttr<A extends string = string, V = unknown>(
  tr: Transaction,
  targets: readonly NodeWithPos[],
  attrName: A,
  next: V | ((prev: V | undefined) => V | undefined),
): boolean {
  if (!targets.length) return false;

  let changed = false;

  for (const { pos } of targets) {
    const currentNode = tr.doc.nodeAt(pos);
    if (!currentNode) continue;

    const prevValue = (currentNode.attrs as Record<string, unknown>)[
      attrName
    ] as V | undefined;
    const resolvedNext =
      typeof next === "function"
        ? (next as (p: V | undefined) => V | undefined)(prevValue)
        : next;

    if (prevValue === resolvedNext) continue;

    const nextAttrs: Record<string, unknown> = { ...currentNode.attrs };
    if (resolvedNext === undefined) {
      delete nextAttrs[attrName];
    } else {
      nextAttrs[attrName] = resolvedNext;
    }

    tr.setNodeMarkup(pos, undefined, nextAttrs);
    changed = true;
  }

  return changed;
}

/**
 * Selects the entire content of the current block node if the selection is empty.
 */
export function selectCurrentBlockContent(editor: Editor) {
  const { selection, doc } = editor.state;

  if (!selection.empty) return;

  const $pos = selection.$from;
  let blockNode = null;
  let blockPos = -1;

  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    const pos = $pos.start(depth);

    if (node.isBlock && node.textContent.trim()) {
      blockNode = node;
      blockPos = pos;
      break;
    }
  }

  if (blockNode && blockPos >= 0) {
    const from = blockPos;
    const to = blockPos + blockNode.nodeSize - 2;

    if (from < to) {
      const $from = doc.resolve(from);
      const $to = doc.resolve(to);
      const newSelection = TextSelection.between($from, $to, 1);

      if (newSelection && !selection.eq(newSelection)) {
        editor.view.dispatch(editor.state.tr.setSelection(newSelection));
      }
    }
  }
}

/**
 * Retrieves all nodes of specified types from the current selection.
 */
export function getSelectedNodesOfType(
  selection: Selection,
  allowedNodeTypes: string[],
): NodeWithPos[] {
  const results: NodeWithPos[] = [];
  const allowed = new Set(allowedNodeTypes);

  if (selection instanceof CellSelection) {
    selection.forEachCell((node: PMNode, pos: number) => {
      if (allowed.has(node.type.name)) {
        results.push({ node, pos });
      }
    });
    return results;
  }

  if (selection instanceof NodeSelection) {
    const { node, from: pos } = selection;
    if (node && allowed.has(node.type.name)) {
      results.push({ node, pos });
    }
    return results;
  }

  const { $anchor } = selection;
  const cell = cellAround($anchor);

  if (cell) {
    const cellNode = selection.$anchor.doc.nodeAt(cell.pos);
    if (cellNode && allowed.has(cellNode.type.name)) {
      results.push({ node: cellNode, pos: cell.pos });
      return results;
    }
  }

  const parentNode = findParentNodeClosestToPos($anchor, (node) =>
    allowed.has(node.type.name),
  );

  if (parentNode) {
    results.push({ node: parentNode.node, pos: parentNode.pos });
  }

  return results;
}

export function shouldShowEditorButton(
  editor: Editor | null,
  hideWhenUnavailable: boolean,
  schemaCheck: () => boolean,
): boolean {
  if (!editor || !editor.isEditable) return false;
  if (!hideWhenUnavailable) return true;
  return schemaCheck();
}

/** Block node types that can be converted via block toggle (heading, list, blockquote, code block). */
export const BLOCK_CONVERTIBLE_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
] as const;

export function prepareBlockToggle(
  editor: Editor,
): ReturnType<typeof editor.chain> {
  let { state } = editor;
  const { view } = editor;
  let { tr } = state;

  const blocks = getSelectedBlockNodes(editor);

  const isPossibleToTurnInto =
    selectionWithinConvertibleTypes(editor, [...BLOCK_CONVERTIBLE_TYPES]) &&
    blocks.length === 1;

  if (
    (state.selection.empty || state.selection instanceof TextSelection) &&
    isPossibleToTurnInto
  ) {
    const pos = findNodePosition({
      editor,
      node: state.selection.$anchor.node(1),
    })?.pos;
    if (isValidPosition(pos)) {
      tr = tr.setSelection(NodeSelection.create(state.doc, pos));
      view.dispatch(tr);
      state = view.state;
    }
  }

  const selection = state.selection;
  let chain = editor.chain().focus();

  if (selection instanceof NodeSelection) {
    const firstChild = selection.node.firstChild?.firstChild;
    const lastChild = selection.node.lastChild?.lastChild;

    const from = firstChild
      ? selection.from + firstChild.nodeSize
      : selection.from + 1;

    const to = lastChild ? selection.to - lastChild.nodeSize : selection.to - 1;

    const resolvedFrom = state.doc.resolve(from);
    const resolvedTo = state.doc.resolve(to);

    chain = chain
      .setTextSelection(TextSelection.between(resolvedFrom, resolvedTo))
      .clearNodes();
  }

  return chain;
}

export function getSelectedBlockNodes(editor: Editor): PMNode[] {
  const { doc } = editor.state;
  const { from, to } = editor.state.selection;

  const blocks: PMNode[] = [];
  const seen = new Set<number>();

  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isBlock) return;

    if (!seen.has(pos)) {
      seen.add(pos);
      blocks.push(node);
    }

    return false;
  });

  return blocks;
}
