import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Compute the section range for a heading: from headingPos to the start of
 * the next top-level heading with level <= headingLevel, or end of document.
 *
 * Section = heading + everything until next same-or-higher level.
 * Standard outliner behavior (Notion, Logseq, Roam).
 */
export function computeSection(
  doc: PMNode,
  headingPos: number,
  headingLevel: number,
): { from: number; to: number } {
  let offset = 0;
  for (let i = 0; i < doc.content.childCount; i++) {
    const node = doc.content.child(i);
    const pos = offset;
    offset += node.nodeSize;
    if (pos <= headingPos) continue;
    if (
      node.type.name === "heading" &&
      (node.attrs.level as number) <= headingLevel
    ) {
      return { from: headingPos, to: pos };
    }
  }
  return { from: headingPos, to: doc.content.size };
}
