import { describe, expect, it } from "bun:test";

import type { Schema } from "@tiptap/pm/model";
import * as Y from "yjs";

import {
  getHeadlessSchema,
  jsonToYDoc,
  yDocToJSON,
} from "@/lib/headless/headless-schema";
import {
  LEGACY_MARK_NAMES,
  SCHEMA_MARK_NAMES,
  SCHEMA_NODE_NAMES,
} from "@/lib/schema-names";

import { ALL_NODES_DOC } from "../../../fixtures/all-nodes-document";
import snapshot from "../../../fixtures/schema-snapshot.json";
import { describeSchema } from "../../../helpers/describe-schema";
import { getEditorSchema } from "../../../helpers/editor-schema";

/**
 * Attribute defaults the editor takes from its upload options
 * (`components/tiptap-node/image-upload-node/upload-utils.ts`). They only
 * matter while an upload placeholder is on screen; export drops the node.
 */
const DEFAULT_EXCEPTIONS = new Set([
  "imageUpload.limit",
  "imageUpload.maxSize",
]);

function attrDefaults(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, type] of Object.entries(schema.nodes)) {
    for (const [attr, spec] of Object.entries(type.spec.attrs ?? {})) {
      out[`${name}.${attr}`] = spec.default;
    }
  }
  for (const [name, type] of Object.entries(schema.marks)) {
    for (const [attr, spec] of Object.entries(type.spec.attrs ?? {})) {
      out[`${name}.${attr}`] = spec.default;
    }
  }
  for (const key of DEFAULT_EXCEPTIONS) delete out[key];
  return out;
}

describe("headless schema", () => {
  it("matches the committed schema snapshot", () => {
    expect(describeSchema(getHeadlessSchema())).toEqual(snapshot);
  });

  it("matches the editor schema, attribute defaults included", () => {
    const headless = getHeadlessSchema();
    const editor = getEditorSchema();
    expect(describeSchema(headless)).toEqual(describeSchema(editor));
    expect(attrDefaults(headless)).toEqual(attrDefaults(editor));
  });

  it("orders marks and nodes like the editor", () => {
    // Mark rank decides Markdown nesting; the first block type is the
    // default one the schema fills in.
    expect(Object.keys(getHeadlessSchema().marks)).toEqual(
      Object.keys(getEditorSchema().marks),
    );
    // `heading` is replaced outside StarterKit (to escape its Markdown), so
    // it sorts later; it is never a group's first (default) member.
    const withoutHeading = (schema: Schema) =>
      Object.keys(schema.nodes).filter((name) => name !== "heading");
    expect(withoutHeading(getHeadlessSchema())).toEqual(
      withoutHeading(getEditorSchema()),
    );
    for (const group of ["block", "inline", "list"]) {
      const first = (schema: Schema) =>
        Object.values(schema.nodes).find((type) => type.isInGroup(group))?.name;
      expect(first(getHeadlessSchema())).toBe(first(getEditorSchema()));
    }
  });

  it("is built once", () => {
    expect(getHeadlessSchema()).toBe(getHeadlessSchema());
  });
});

describe("all-nodes fixture", () => {
  it("is valid in the editor schema and uses every node and mark", () => {
    const node = getEditorSchema().nodeFromJSON(ALL_NODES_DOC);
    node.check();
    const nodes = new Set<string>();
    const marks = new Set<string>();
    node.descendants((child) => {
      nodes.add(child.type.name);
      for (const mark of child.marks) marks.add(mark.type.name);
    });
    nodes.add("doc");
    expect([...nodes].sort()).toEqual([...SCHEMA_NODE_NAMES].sort());
    expect([...marks].sort()).toEqual(
      [...SCHEMA_MARK_NAMES]
        .filter(
          (name) => !(LEGACY_MARK_NAMES as readonly string[]).includes(name),
        )
        .sort(),
    );
  });
});

describe("Y.Doc conversion", () => {
  it("round-trips the all-nodes document through a Y.Doc", () => {
    const ydoc = jsonToYDoc(ALL_NODES_DOC);
    const back = yDocToJSON(ydoc);
    const expected = getHeadlessSchema().nodeFromJSON(ALL_NODES_DOC).toJSON();
    expect(back).toEqual(expected);
  });

  it("writes the editor's `default` fragment", () => {
    const ydoc = jsonToYDoc(ALL_NODES_DOC);
    expect(ydoc.getXmlFragment("default").length).toBeGreaterThan(0);
  });

  it("does not change the source Y.Doc when reading it", () => {
    const ydoc = jsonToYDoc(ALL_NODES_DOC);
    const before = Y.encodeStateVector(ydoc);
    let updates = 0;
    ydoc.on("update", () => {
      updates += 1;
    });
    yDocToJSON(ydoc);
    expect(updates).toBe(0);
    expect(Y.encodeStateVector(ydoc)).toEqual(before);
  });

  it("refuses content that does not fit the schema", () => {
    expect(() =>
      jsonToYDoc({ type: "doc", content: [{ type: "paragraph" }] }),
    ).toThrow();
  });

  it("refuses a Y.Doc with node names the schema does not know", () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("default");
    const heading = new Y.XmlElement("heading");
    heading.setAttribute("level", 1 as unknown as string);
    fragment.insert(0, [heading, new Y.XmlElement("evilNode")]);
    expect(() => yDocToJSON(ydoc)).toThrow(/evilNode/);
  });

  it("reads an empty Y.Doc as the minimal title-first document", () => {
    expect(yDocToJSON(new Y.Doc())).toEqual({
      type: "doc",
      content: [{ type: "heading", attrs: expect.any(Object) }],
    });
  });
});
