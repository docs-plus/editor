import type { Schema } from "@tiptap/pm/model";
import * as Y from "yjs";

import { markNameFromKey } from "@/lib/schema-names";

/** Transaction origin, so update listeners can tell schema repairs apart. */
export const SCHEMA_REPAIR_ORIGIN = Symbol("schema-repair");

/** What `repairKnownMisfit` wrote to the fragment. */
export type RepairResult = "inserted-title" | "seeded" | "none";

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

/**
 * Repairs the title-first misfits made of known names: an empty fragment is
 * seeded with a title and a paragraph, and a fragment that does not start
 * with a heading gets an empty title. Writes straight to Yjs, in one
 * transaction, because the frozen editor drops ProseMirror writes.
 *
 * Call it after `onInvalidContent` returns: inside the binding's `mux` the
 * resulting Yjs event is swallowed and the editor stays frozen.
 */
export function repairKnownMisfit(fragment: Y.XmlFragment): RepairResult {
  const doc = fragment.doc;
  if (!doc) throw new Error("The Yjs fragment must belong to a document");

  let result: RepairResult = "none";
  doc.transact(() => {
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
  }, SCHEMA_REPAIR_ORIGIN);
  return result;
}
