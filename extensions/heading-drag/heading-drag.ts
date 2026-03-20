/**
 * HeadingDrag — drag-and-drop reordering for heading sections.
 *
 * Adds a floating drag handle beside each heading (except the title H1).
 * Dragging a heading moves its entire "section": the heading plus all
 * content below it until the next same-or-higher-level heading.
 *
 * Architecture based on @tiptap/extension-drag-handle v3.20.1:
 *   - Handle rendered outside contenteditable, positioned via @floating-ui/dom
 *   - Custom mouse events (no HTML5 DnD) for section-level drag
 *   - Notion-style visual feedback: drag ghost, drop indicator, section opacity
 *   - Node decorations for CSS hooks (mapped for typing, rebuilt for structural edits)
 *
 * See docs/brainstorms/2-heading-drag-drop-brainstorm.md
 */

import { Extension } from "@tiptap/core";

import { createHeadingDragPlugin } from "./heading-drag-plugin";

export const HeadingDrag = Extension.create({
  name: "headingDrag",

  addProseMirrorPlugins() {
    return [createHeadingDragPlugin()];
  },
});
