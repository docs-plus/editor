/**
 * HeadingScale — dynamic heading sizing based on rank within H1-delimited sections.
 *
 * Instead of fixed font-sizes per HTML level (H1=20pt, H2=16pt, ...),
 * this extension sizes headings by their **rank** among the distinct levels
 * present in each section. A section is defined as an H1 and every heading
 * below it until the next H1.
 *
 * Example — two sections with different level combinations:
 *
 *   Section A: H1 → H2 → H4        (3 distinct ranks → 20pt, 16pt, 12pt)
 *   Section B: H1 → H3 → H5        (3 distinct ranks → 20pt, 16pt, 12pt)
 *
 * Both get identical visual sizing because they share the same rank count,
 * even though the underlying HTML levels differ.
 *
 * How it works:
 *   1. A ProseMirror plugin scans top-level heading nodes on doc changes.
 *   2. Headings are grouped into sections (each H1 starts a new section).
 *   3. Within each section, distinct levels are sorted and assigned 0-based ranks.
 *   4. Sizes are interpolated: size = MAX - rank * (MAX - MIN) / (totalRanks - 1)
 *   5. A `Decoration.node()` sets `--hd-size` as an inline CSS custom property.
 *   6. The SCSS rule `font-size: var(--hd-size, fallback)` picks up the value;
 *      nested headings (inside blockquotes, lists) don't get decorations and
 *      fall back to their default sizes.
 *
 * Performance: content-only edits (typing, backspace within a block) use
 * `DecorationSet.map()` for O(log H) position remapping. Structural changes
 * (splits, joins, moves, heading insertions) trigger a full O(N) rebuild.
 * The safety check (`canMapDecorations`) validates that a step doesn't cross
 * node boundaries or change document structure before allowing the fast path.
 */

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { canMapDecorations } from "@/components/tiptap-node/heading-node/helpers/can-map-decorations";

/** Interpolation bounds (in pt) for the largest and smallest heading rank. */
const MAX_SIZE = 20;
const MIN_SIZE = 12;

const pluginKey = new PluginKey("headingScale");

type HeadingEntry = { pos: number; level: number; nodeSize: number };

/**
 * Full decoration rebuild. Scans all top-level headings, groups them into
 * H1-delimited sections, ranks distinct levels per section, and creates
 * `Decoration.node()` entries with interpolated `--hd-size` values.
 */
function buildDecorations(doc: PMNode): DecorationSet {
  const headings: HeadingEntry[] = [];

  doc.forEach((node, offset) => {
    if (node.type.name === "heading") {
      headings.push({
        pos: offset,
        level: node.attrs.level as number,
        nodeSize: node.nodeSize,
      });
    }
  });

  if (headings.length === 0) return DecorationSet.empty;

  // Group into sections — each level-1 heading starts a new section
  const sections: HeadingEntry[][] = [];
  let current: HeadingEntry[] = [];

  for (const h of headings) {
    if (h.level === 1 && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push(h);
  }
  if (current.length > 0) sections.push(current);

  const decorations: Decoration[] = [];

  for (const section of sections) {
    const distinct = [...new Set(section.map((h) => h.level))].sort(
      (a, b) => a - b,
    );
    const totalRanks = distinct.length;

    for (const h of section) {
      const rank = distinct.indexOf(h.level);
      const size =
        totalRanks === 1
          ? MAX_SIZE
          : MAX_SIZE - (rank * (MAX_SIZE - MIN_SIZE)) / (totalRanks - 1);

      decorations.push(
        Decoration.node(h.pos, h.pos + h.nodeSize, {
          style: `--hd-size: ${Number(size.toFixed(2))}pt`,
        }),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

export const HeadingScale = Extension.create({
  name: "headingScale",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: pluginKey,

        state: {
          init(_, state) {
            return buildDecorations(state.doc);
          },

          apply(tr, prev, oldState, newState) {
            if (!tr.docChanged) return prev;
            if (canMapDecorations(tr, oldState.doc)) {
              return prev.map(tr.mapping, newState.doc);
            }
            return buildDecorations(newState.doc);
          },
        },

        props: {
          decorations(state) {
            return pluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
