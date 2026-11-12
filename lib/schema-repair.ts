import { type Fragment, type Node, type Schema, Slice } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import {
  type BindingMetadata,
  initProseMirrorDoc,
  updateYFragment,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { markNameFromKey } from "@/lib/schema-names";

/** Transaction origin, so update listeners can tell schema repairs apart. */
export const SCHEMA_REPAIR_ORIGIN = Symbol("schema-repair");

/**
 * What `repairKnownMisfit` wrote to the fragment: the first title-first
 * repair it made, else `fitted` for any other content it fitted.
 */
export type RepairResult = "inserted-title" | "seeded" | "fitted" | "none";

function collectUnknownNames(
  parent: Y.XmlFragment | Y.XmlElement,
  schema: Schema,
  names: Set<string>,
  limit: number,
): void {
  for (const child of parent.toArray()) {
    if (names.size >= limit) return;
    if (child instanceof Y.XmlElement) {
      if (!schema.nodes[child.nodeName]) names.add(child.nodeName);
      collectUnknownNames(child, schema, names, limit);
    } else if (child instanceof Y.XmlText) {
      for (const delta of child.toDelta()) {
        for (const key of Object.keys(delta.attributes ?? {})) {
          if (names.size >= limit) return;
          const name = markNameFromKey(key);
          if (!schema.marks[name]) names.add(name);
        }
      }
    }
  }
}

/**
 * Node and mark names in the fragment that the schema does not know, unique
 * and in walk order, at most `limit` of them.
 */
export function findUnknownSchemaNames(
  fragment: Y.XmlFragment,
  schema: Schema,
  limit = 20,
): string[] {
  const names = new Set<string>();
  collectUnknownNames(fragment, schema, names, limit);
  return [...names];
}

/** Empty level-1 heading, with the level stored as y-prosemirror does. */
function title(): Y.XmlElement {
  const heading = new Y.XmlElement<{ level: number }>("heading");
  heading.setAttribute("level", 1);
  return heading as Y.XmlElement;
}

/** Top-level text or hooks: y-tiptap cannot project them at all. */
function deleteStrayRootContent(fragment: Y.XmlFragment): void {
  for (let index = fragment.length - 1; index >= 0; index--) {
    if (!(fragment.get(index) instanceof Y.XmlElement)) {
      fragment.delete(index, 1);
    }
  }
}

/**
 * Elements named `text`: y-prosemirror keeps text in `Y.XmlText`, and the
 * projection would build a text node without text from one.
 */
function deleteTextElements(parent: Y.XmlFragment | Y.XmlElement): void {
  const children = parent.toArray();
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index];
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === "text") parent.delete(index, 1);
    else deleteTextElements(child);
  }
}

/**
 * `content` fitted into the top node, as ProseMirror fits a pasted slice:
 * stray inline nodes are wrapped in a paragraph, misplaced blocks dropped.
 * Null when it already fits.
 */
function fitDocument(schema: Schema, content: Fragment): Node | null {
  const { topNodeType } = schema;
  if (topNodeType.validContent(content)) return null;
  const empty = topNodeType.createAndFill();
  if (!empty) return null;
  return new Transform(empty).replace(
    0,
    empty.content.size,
    new Slice(content, 0, 0),
  ).doc;
}

/**
 * Writes the fitted document's blocks to the fragment. A block the fit kept
 * (the very node it was projected to) is left alone, so it keeps attributes
 * this release does not know: `updateYFragment` on the whole fragment would
 * rewrite it once the block count changes. Each run of blocks between kept
 * ones is replaced by new elements, filled by `updateYFragment`.
 */
function writeFitted(
  doc: Y.Doc,
  fragment: Y.XmlFragment,
  fitted: Node,
  meta: BindingMetadata,
): void {
  const indexOf = new Map<unknown, number>();
  fragment.toArray().forEach((child, index) => {
    const projected = meta.mapping.get(child);
    if (projected) indexOf.set(projected, index);
  });
  // From the end, so the indices of earlier blocks stay valid.
  let yEnd = fragment.length;
  let pEnd = fitted.childCount;
  for (let pIndex = fitted.childCount - 1; pIndex >= -1; pIndex--) {
    const yIndex = pIndex < 0 ? -1 : indexOf.get(fitted.child(pIndex));
    if (yIndex === undefined || yIndex >= yEnd) continue;
    fragment.delete(yIndex + 1, yEnd - yIndex - 1);
    const nodes = fitted.content.content.slice(pIndex + 1, pEnd);
    const elements = nodes.map((node) => new Y.XmlElement(node.type.name));
    fragment.insert(yIndex + 1, elements);
    elements.forEach((element, i) => {
      updateYFragment(doc, element, nodes[i], meta);
    });
    yEnd = yIndex;
    pEnd = pIndex;
  }
}

const wroteAnything = (transaction: Y.Transaction) =>
  transaction.changed.size > 0 || transaction.deleteSet.clients.size > 0;

/**
 * Makes known-name content fit the schema, writing straight to Yjs in one
 * transaction, because the frozen editor drops ProseMirror writes:
 *
 * 1. Top-level text and `text` elements are deleted.
 * 2. Title first: an empty fragment is seeded with a title and a paragraph;
 *    one that does not start with a heading gets an empty title.
 * 3. Elements whose content does not fit their node are deleted, as y-tiptap
 *    did before `onInvalidContent` (an empty list item, a list holding a
 *    bare paragraph). Untouched blocks keep their Yjs identity.
 * 4. Top-level content that fits no slot is fitted as a paste is: a stray
 *    hard break or inline node is wrapped in a paragraph.
 *
 * Unknown names are not handled here: they mean a newer bundle wrote the
 * content, and deleting it would lose that bundle's work.
 *
 * Call it after `onInvalidContent` returns: inside the binding's `mux` the
 * resulting Yjs event is swallowed and the editor stays frozen.
 */
export function repairKnownMisfit(
  fragment: Y.XmlFragment,
  schema: Schema,
): RepairResult {
  const doc = fragment.doc;
  if (!doc) throw new Error("The Yjs fragment must belong to a document");

  let result: RepairResult = "none";
  doc.transact((transaction) => {
    deleteStrayRootContent(fragment);
    deleteTextElements(fragment);
    if (fragment.length === 0) {
      fragment.insert(0, [title(), new Y.XmlElement("paragraph")]);
      result = "seeded";
      return;
    }
    const first = fragment.get(0);
    if (!(first instanceof Y.XmlElement) || first.nodeName !== "heading") {
      fragment.insert(0, [title()]);
      result = "inserted-title";
    }
    // Without `reportInvalidContent`, projecting deletes misfit elements.
    // One shared mapping tells which blocks the fit left alone.
    const { doc: projected, meta } = initProseMirrorDoc(fragment, schema);
    const fitted = fitDocument(schema, projected.content);
    if (fitted) writeFitted(doc, fragment, fitted, meta);
    if (result === "none" && wroteAnything(transaction)) result = "fitted";
  }, SCHEMA_REPAIR_ORIGIN);
  return result;
}
