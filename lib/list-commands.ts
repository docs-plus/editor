import type { NodeType, Node as PMNode } from "@tiptap/pm/model";
import { Selection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

import {
  BLOCK_CONVERTIBLE_TYPES,
  isNodeInSchema,
  isNodeTypeSelected,
  prepareBlockToggle,
  selectionWithinConvertibleTypes,
} from "@/lib/editor-utils";
import type { ListType } from "@/lib/remembered-choice";

/*
 * List commands shared by the registry's `list.*` actions and the list
 * menu (moved from `components/tiptap-ui/list-button/use-list.ts` so the
 * registry can run them; contract §10 A6).
 */

/** The registry action behind each list type (M9 face and list menu). */
export const LIST_ACTION_IDS: Record<ListType, string> = {
  bulletList: "list.bullet",
  orderedList: "list.ordered",
  taskList: "list.task",
};

/**
 * Checks if a list can be toggled in the current editor state
 */
export function canToggleList(
  editor: Editor | null,
  type: ListType,
  turnInto: boolean = true,
): boolean {
  if (!editor?.isEditable) return false;
  if (!isNodeInSchema(type, editor) || isNodeTypeSelected(editor, ["image"]))
    return false;

  if (!turnInto) {
    switch (type) {
      case "bulletList":
        return editor.can().toggleBulletList();
      case "orderedList":
        return editor.can().toggleOrderedList();
      case "taskList":
        return editor.can().toggleList("taskList", "taskItem");
      default:
        return false;
    }
  }

  // Ensure selection is in nodes we're allowed to convert
  if (!selectionWithinConvertibleTypes(editor, [...BLOCK_CONVERTIBLE_TYPES]))
    return false;

  // Either we can set list directly on the selection,
  // or we can clear formatting/nodes to arrive at a list.
  switch (type) {
    case "bulletList":
      return editor.can().toggleBulletList() || editor.can().clearNodes();
    case "orderedList":
      return editor.can().toggleOrderedList() || editor.can().clearNodes();
    case "taskList":
      return (
        editor.can().toggleList("taskList", "taskItem") ||
        editor.can().clearNodes()
      );
    default:
      return false;
  }
}

const LIST_ITEM_TYPES: Record<ListType, string> = {
  bulletList: "listItem",
  orderedList: "listItem",
  taskList: "taskItem",
};

function isListNode(node: PMNode): boolean {
  return Object.hasOwn(LIST_ITEM_TYPES, node.type.name);
}

/** Rebuilds a list, and every list nested in it, as `listType`. Content and
 * nesting stay; item attributes (task checked state) only where the item type
 * stays the same. Node sizes are unchanged. */
function retypeList(
  list: PMNode,
  listType: NodeType,
  itemType: NodeType,
): PMNode {
  const items: PMNode[] = [];
  list.forEach((item) => {
    const children: PMNode[] = [];
    item.forEach((child) => {
      children.push(
        isListNode(child) ? retypeList(child, listType, itemType) : child,
      );
    });
    items.push(
      itemType.createChecked(
        item.type === itemType ? item.attrs : null,
        children,
        item.marks,
      ),
    );
  });
  return listType.createChecked(
    list.type === listType ? list.attrs : null,
    items,
    list.marks,
  );
}

/** Retypes the outermost lists the selection touches, in place. */
function retypeListsInSelection(tr: Transaction, type: ListType): boolean {
  const { schema } = tr.doc.type;
  const listType = schema.nodes[type];
  const itemType = schema.nodes[LIST_ITEM_TYPES[type]];
  if (!listType || !itemType) return false;

  const lists: { node: PMNode; pos: number }[] = [];
  tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
    if (!isListNode(node)) return true;
    lists.push({ node, pos });
    return false;
  });
  if (lists.length === 0) return false;

  // Sizes do not change, so positions stay valid across the replacements and
  // the selection can be restored as it was.
  const selection = tr.selection.toJSON();
  for (const { node, pos } of lists) {
    tr.replaceWith(
      pos,
      pos + node.nodeSize,
      retypeList(node, listType, itemType),
    );
  }
  tr.setSelection(Selection.fromJSON(tr.doc, selection));
  return true;
}

/**
 * Turns the list around the selection into `type` in one transaction (one
 * undo step), keeping every item, nested lists and the selection.
 */
export function setListTypeInPlace(
  editor: Editor | null,
  type: ListType,
): boolean {
  if (!editor?.isEditable || !isNodeInSchema(type, editor)) return false;
  try {
    return editor
      .chain()
      .focus()
      .command(({ tr }) => retypeListsInSelection(tr, type))
      .run();
  } catch {
    return false;
  }
}

function isInOtherList(editor: Editor, type: ListType): boolean {
  return (Object.keys(LIST_ITEM_TYPES) as ListType[]).some(
    (other) => other !== type && editor.isActive(other),
  );
}

/**
 * Toggles list in the editor
 */
export function toggleList(editor: Editor | null, type: ListType): boolean {
  if (!editor?.isEditable) return false;
  if (!canToggleList(editor, type)) return false;
  if (!editor.isActive(type) && isInOtherList(editor, type)) {
    return setListTypeInPlace(editor, type);
  }

  try {
    const before = editor.state.doc;
    const chain = prepareBlockToggle(editor);

    if (editor.isActive(type)) {
      // Unwrap list
      chain
        .liftListItem("listItem")
        .lift("bulletList")
        .lift("orderedList")
        .lift("taskList")
        .run();
    } else {
      // Wrap in specific list type
      const toggleMap: Record<ListType, () => typeof chain> = {
        bulletList: () => chain.toggleBulletList(),
        orderedList: () => chain.toggleOrderedList(),
        taskList: () => chain.toggleList("taskList", "taskItem"),
      };

      const toggle = toggleMap[type];
      if (!toggle) return false;

      toggle().run();
    }

    // Chained lifts report false when one of them has nothing to lift, so
    // success is "the document changed" (memory writes only on success).
    if (editor.state.doc === before) return false;
    editor.chain().focus().selectTextblockEnd().run();

    return true;
  } catch {
    return false;
  }
}
