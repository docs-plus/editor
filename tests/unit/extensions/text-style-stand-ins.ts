/**
 * Test-only stand-ins for PR C's `textColor` / `fontSize` marks with the
 * contract shape (one token attribute each, inclusive, self-exclusive), so
 * PR E's bundle code is tested before PR C registers the real marks.
 */
import { Mark } from "@tiptap/core";

export const TextColorStandIn = Mark.create({
  name: "textColor",
  inclusive: true,
  addAttributes() {
    return { color: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-text-color]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-text-color": HTMLAttributes.color }, 0];
  },
});

export const FontSizeStandIn = Mark.create({
  name: "fontSize",
  inclusive: true,
  addAttributes() {
    return { size: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-font-size]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-font-size": HTMLAttributes.size }, 0];
  },
});
