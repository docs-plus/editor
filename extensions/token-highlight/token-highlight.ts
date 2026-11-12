import type { Attribute } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";

import { highlightTokenFromValue } from "@/lib/highlight-tokens";

/**
 * Stock Highlight with token-aware rendering. The attribute key, default,
 * parseHTML and the schema are unchanged; only `renderHTML` differs: a known
 * token (bare or legacy `var(--tt-color-highlight-X)`) renders
 * `data-highlight`, styled by CSS, and anything else renders no style at all.
 */
export const TokenHighlight = Highlight.extend({
  addAttributes() {
    const parent = (this.parent?.() ?? {}) as Record<string, Attribute>;
    if (!parent.color) return parent;
    return {
      ...parent,
      color: {
        ...parent.color,
        renderHTML: (attributes: Record<string, unknown>) => {
          const token = highlightTokenFromValue(attributes.color);
          return token
            ? {
                "data-color": attributes.color as string,
                "data-highlight": token,
              }
            : {};
        },
      },
    };
  },
});
