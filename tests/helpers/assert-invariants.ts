import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { expect } from "vitest";
import { computeSection } from "@/components/tiptap-node/heading-node/helpers/compute-section";

const VALID_BLOCK_NAMES = new Set([
  "heading",
  "paragraph",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "listItem",
  "horizontalRule",
  "image",
]);

/** Asserts the first child is a heading with level 1. */
export function assertFirstNodeIsH1(doc: PMNode): void {
  const first = doc.firstChild;
  expect(first).toBeDefined();
  expect(first?.type.name).toBe("heading");
  expect(first?.attrs.level).toBe(1);
}

/** Asserts all top-level children match heading | block*. */
export function assertValidSchema(doc: PMNode): void {
  assertFirstNodeIsH1(doc);
  for (let i = 1; i < doc.childCount; i++) {
    const child = doc.child(i);
    expect(VALID_BLOCK_NAMES.has(child.type.name)).toBe(true);
  }
}

/** Asserts all heading nodes have level 1–6. */
export function assertHeadingLevels(doc: PMNode): void {
  doc.descendants((node) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(6);
    }
  });
}

/** Asserts all heading IDs (data-toc-id or id) are non-null and unique. */
export function assertUniqueIds(doc: PMNode): void {
  const ids: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "heading") {
      const id =
        (node.attrs["data-toc-id"] as string | null | undefined) ??
        (node.attrs.id as string | null | undefined);
      expect(id, `Heading at ${node.type.name} should have id`).toBeTruthy();
      if (id) ids.push(id);
    }
  });
  const unique = new Set(ids);
  expect(unique.size).toBe(ids.length);
}

/** Asserts each heading's computeSection returns valid { from, to } with to <= doc.content.size. */
export function assertSectionBoundaries(doc: PMNode): void {
  let offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const { from, to } = computeSection(doc, offset, level, i);
      expect(from).toBe(offset);
      expect(to).toBeGreaterThanOrEqual(from);
      expect(to).toBeLessThanOrEqual(doc.content.size);
    }
    offset += node.nodeSize;
  }
}

/** Asserts JSON roundtrip: Node.fromJSON(schema, doc.toJSON()) deep equals doc.toJSON(). */
export function assertMarksRoundtrip(doc: PMNode, schema: Schema): void {
  const json = doc.toJSON();
  const restored = schema.nodeFromJSON(json);
  expect(restored.toJSON()).toEqual(json);
}

export function assertInvariantsFromJSON(json: {
  content?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
}): void {
  const content = json?.content;
  if (!content || content.length === 0) {
    throw new Error("Document has no content");
  }
  const first = content[0];
  if (first.type !== "heading") {
    throw new Error(`First node is "${first.type}", expected "heading"`);
  }
  if (first.attrs?.level !== 1) {
    throw new Error(`First heading level is ${first.attrs?.level}, expected 1`);
  }
  for (const node of content) {
    if (node.type === "heading") {
      const level = node.attrs?.level as number;
      if (level < 1 || level > 6) {
        throw new Error(`Invalid heading level: ${level}`);
      }
    }
  }
}

export interface AssertAllInvariantsOptions {
  /** Skip unique IDs check when doc has no ids (e.g. fixture/generated docs). */
  skipUniqueIds?: boolean;
}

/** Runs all invariant assertions. */
export function assertAllInvariants(
  doc: PMNode,
  schema: Schema,
  options: AssertAllInvariantsOptions = {},
): void {
  const { skipUniqueIds = false } = options;
  assertFirstNodeIsH1(doc);
  assertValidSchema(doc);
  assertHeadingLevels(doc);
  if (!skipUniqueIds) assertUniqueIds(doc);
  assertSectionBoundaries(doc);
  assertMarksRoundtrip(doc, schema);
}
