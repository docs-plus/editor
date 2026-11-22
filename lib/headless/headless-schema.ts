import { getSchema, type JSONContent } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { buildHeadlessSchemaExtensions } from "./schema-extensions";

/** The Y.XmlFragment the editor binds (`CollaborationRenderOnce`). */
export const DOCUMENT_FRAGMENT = "default";

let schema: Schema | null = null;

/** The editor's ProseMirror schema, built once, with no view or DOM. */
export function getHeadlessSchema(): Schema {
  schema ??= getSchema(buildHeadlessSchemaExtensions());
  return schema;
}

/**
 * Node and mark names in a fragment that the schema does not know.
 * y-prosemirror drops unknown nodes silently, so they are checked first.
 */
function unknownNames(fragment: Y.XmlFragment, target: Schema): string[] {
  const names = new Set<string>();
  const visit = (parent: Y.XmlFragment | Y.XmlElement) => {
    for (const child of parent.toArray()) {
      if (child instanceof Y.XmlElement) {
        if (!target.nodes[child.nodeName]) names.add(child.nodeName);
        visit(child);
      } else if (child instanceof Y.XmlText) {
        for (const op of child.toDelta() as Array<{
          attributes?: Record<string, unknown>;
        }>) {
          for (const key of Object.keys(op.attributes ?? {})) {
            const name = key.replace(/--[a-zA-Z0-9+/=]{8}$/, "");
            if (!target.marks[name]) names.add(name);
          }
        }
      }
    }
  };
  visit(fragment);
  return [...names];
}

/** Thrown when stored content does not fit the editor schema. */
export class SchemaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaMismatchError";
  }
}

/**
 * The document in `ydoc` as a ProseMirror node. Read-only: it never writes
 * to `ydoc`. Unknown node or mark names (a document from a newer build, or
 * legacy marks not yet migrated) throw instead of being dropped.
 */
export function yDocToProseMirror(ydoc: Y.Doc): PMNode {
  const target = getHeadlessSchema();
  const fragment = ydoc.getXmlFragment(DOCUMENT_FRAGMENT);
  const unknown = unknownNames(fragment, target);
  if (unknown.length) {
    throw new SchemaMismatchError(
      `Unknown names in the document: ${unknown.join(", ")}`,
    );
  }
  // A document never opened in an editor has an empty fragment: read it as
  // the minimal title-first document the editor would seed.
  if (fragment.length === 0) {
    return target.topNodeType.createAndFill() as PMNode;
  }
  const node = yXmlFragmentToProseMirrorRootNode(fragment, target);
  try {
    node.check();
  } catch (error) {
    throw new SchemaMismatchError((error as Error).message);
  }
  return node;
}

/** The document in `ydoc` as ProseMirror JSON. */
export function yDocToJSON(ydoc: Y.Doc): JSONContent {
  return yDocToProseMirror(ydoc).toJSON() as JSONContent;
}

/** Validates JSON against the schema and returns the node. */
export function proseMirrorFromJSON(json: JSONContent): PMNode {
  const node = getHeadlessSchema().nodeFromJSON(json);
  node.check();
  return node;
}

/**
 * A new Y.Doc holding `json` in the editor's fragment. Throws when `json`
 * does not fit the schema.
 */
export function jsonToYDoc(json: JSONContent): Y.Doc {
  const node = proseMirrorFromJSON(json);
  const ydoc = new Y.Doc();
  prosemirrorToYXmlFragment(node, ydoc.getXmlFragment(DOCUMENT_FRAGMENT));
  return ydoc;
}
