import {
  type Attribute,
  getMarkAttributes,
  isMarkActive,
  markInputRule,
  markPasteRule,
} from "@tiptap/core";
import { Highlight, inputRegex, pasteRegex } from "@tiptap/extension-highlight";
import type { EditorState } from "@tiptap/pm/state";

import { highlightTokenFromValue } from "@/lib/highlight-tokens";
import { HIGHLIGHT_ATTR, type HighlightToken } from "@/lib/text-style-tokens";

/** Colour for `toggleHighlight()`, Mod-Shift-H and `==x==`. */
export const DEFAULT_HIGHLIGHT_TOKEN: HighlightToken = "yellow";

/** Our own copies: `data-highlight` (N+1), else `data-color` (N). Never `style`. */
const tokenOf = (element: HTMLElement): HighlightToken | null =>
  highlightTokenFromValue(element.getAttribute(HIGHLIGHT_ATTR)) ??
  highlightTokenFromValue(element.getAttribute("data-color"));

/**
 * The token a command stores, or null to refuse. A missing colour is the
 * default token. A token or the legacy `var(--tt-color-highlight-X)` is stored
 * as the token X (release N renders both). Anything else (hex,
 * `var(--background)`, hostile strings) is refused.
 */
const commandToken = (attributes?: {
  color?: unknown;
}): HighlightToken | null =>
  attributes?.color === undefined
    ? DEFAULT_HIGHLIGHT_TOKEN
    : highlightTokenFromValue(attributes.color);

/**
 * The palette token of the highlight on the selection (stored marks on an
 * empty selection), with legacy values mapped to their token. Null when the
 * selection has no highlight, or one with an unknown value. Pressed states
 * compare this, never the raw stored string.
 */
export function activeHighlightToken(
  state: EditorState,
): HighlightToken | null {
  const type = state.schema.marks.highlight;
  if (!type || !isMarkActive(state, type)) return null;
  return highlightTokenFromValue(getMarkAttributes(state, type).color);
}

/**
 * Stock Highlight with token values (spec §3, B4). The attribute key stays
 * `color` and the schema is unchanged.
 * - Render: a known token (bare or legacy `var(--tt-color-highlight-X)`)
 *   renders `data-highlight` and `data-color` as the token, styled by CSS;
 *   anything else renders no style at all.
 * - Parse: only our own `<mark>` with a token; foreign `<mark>` and
 *   `background-color` paste as plain text.
 * - Commands take a token (or the legacy form, stored as its token), default
 *   to yellow, and refuse everything else. Toggling compares tokens, so a
 *   legacy value toggles off like its token.
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
          const color = commandToken(attributes);
          return color ? commands.setMark(this.name, { color }) : false;
        },
      // Stock toggleMark compares raw attribute strings; compare tokens so a
      // legacy value counts as its token. No colour (Mod-Shift-H) removes any
      // highlight, as stock does, else sets the default.
      toggleHighlight:
        (attributes) =>
        ({ state, commands }) => {
          if (attributes?.color === undefined) {
            return isMarkActive(state, this.type)
              ? commands.unsetMark(this.name)
              : commands.setMark(this.name, { color: DEFAULT_HIGHLIGHT_TOKEN });
          }
          const color = commandToken(attributes);
          if (!color) return false;
          return activeHighlightToken(state) === color
            ? commands.unsetMark(this.name)
            : commands.setMark(this.name, { color });
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
