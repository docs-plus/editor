import { type Attribute, markInputRule, markPasteRule } from "@tiptap/core";
import { Highlight, inputRegex, pasteRegex } from "@tiptap/extension-highlight";

import { highlightTokenFromValue } from "@/lib/highlight-tokens";
import { HIGHLIGHT_ATTR, type HighlightToken } from "@/lib/text-style-tokens";

/** Colour for `toggleHighlight()`, Mod-Shift-H and `==x==`. */
export const DEFAULT_HIGHLIGHT_TOKEN: HighlightToken = "yellow";

/** Our own copies: `data-highlight` (N+1), else `data-color` (N). Never `style`. */
const tokenOf = (element: HTMLElement): HighlightToken | null =>
  highlightTokenFromValue(element.getAttribute(HIGHLIGHT_ATTR)) ??
  highlightTokenFromValue(element.getAttribute("data-color"));

/**
 * The value a command stores, or null to refuse. A missing colour is the
 * default token. A token or the exact legacy `var(--tt-color-highlight-X)` is
 * stored as given, so the release N popover (D2-owned, replaced in v1) keeps
 * its pressed state; both forms render the same token. Anything else
 * (hex, `var(--background)`, hostile strings) is refused.
 */
const commandColor = (attributes?: { color?: unknown }): string | null => {
  if (attributes?.color === undefined) return DEFAULT_HIGHLIGHT_TOKEN;
  return highlightTokenFromValue(attributes.color)
    ? (attributes.color as string)
    : null;
};

/**
 * Stock Highlight with token values (spec §3, B4). The attribute key stays
 * `color` and the schema is unchanged.
 * - Render: a known token (bare or legacy `var(--tt-color-highlight-X)`)
 *   renders `data-highlight` and `data-color` as the token, styled by CSS;
 *   anything else renders no style at all.
 * - Parse: only our own `<mark>` with a token; foreign `<mark>` and
 *   `background-color` paste as plain text.
 * - Commands take a token (or the legacy form, stored as given), default to
 *   yellow, and refuse everything else.
 */
export const TokenHighlight = Highlight.extend({
  addAttributes() {
    const parent = (this.parent?.() ?? {}) as Record<string, Attribute>;
    if (!parent.color) return parent;
    return {
      ...parent,
      color: {
        ...parent.color,
        parseHTML: tokenOf,
        renderHTML: (attributes: Record<string, unknown>) => {
          const token = highlightTokenFromValue(attributes.color);
          return token ? { "data-color": token, [HIGHLIGHT_ATTR]: token } : {};
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark",
        getAttrs: (element) => (tokenOf(element) ? null : false),
      },
    ];
  },

  addCommands() {
    return {
      setHighlight:
        (attributes) =>
        ({ commands }) => {
          const color = commandColor(attributes);
          return color ? commands.setMark(this.name, { color }) : false;
        },
      toggleHighlight:
        (attributes) =>
        ({ commands }) => {
          const color = commandColor(attributes);
          return color ? commands.toggleMark(this.name, { color }) : false;
        },
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addInputRules() {
    return [
      markInputRule({
        find: inputRegex,
        type: this.type,
        getAttributes: () => ({ color: DEFAULT_HIGHLIGHT_TOKEN }),
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: pasteRegex,
        type: this.type,
        getAttributes: () => ({ color: DEFAULT_HIGHLIGHT_TOKEN }),
      }),
    ];
  },

  parseMarkdown: (token, h) =>
    h.applyMark("highlight", h.parseInline(token.tokens || []), {
      color: DEFAULT_HIGHLIGHT_TOKEN,
    }),
});
