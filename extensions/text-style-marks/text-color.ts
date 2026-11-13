import { Mark } from "@tiptap/core";

import {
  isTextColorToken,
  TEXT_COLOR_ATTR,
  TEXT_COLOR_MARK,
  type TextColorToken,
} from "@/lib/text-style-tokens";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      /** Applies a palette colour; an empty selection sets a stored mark. False for anything but a token. */
      setTextColor: (token: TextColorToken) => ReturnType;
      /** Removes colour from the selection, or from the whole run around an empty cursor. */
      unsetTextColor: () => ReturnType;
    };
  }
}

const tokenOf = (element: HTMLElement): TextColorToken | null => {
  const value = element.getAttribute(TEXT_COLOR_ATTR);
  return isTextColorToken(value) ? value : null;
};

/**
 * Text colour as a palette token (spec §3). Standalone mark, not
 * `textStyle`: one attribute, rendered only as `data-text-color` for a known
 * token, never as inline style. Anything else, from a raw Yjs client or a
 * paste, renders as a plain `<span>`. Foreign `color` styles never parse.
 */
export const TextColor = Mark.create({
  name: TEXT_COLOR_MARK,

  inclusive: true,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: tokenOf,
        renderHTML: (attributes: Record<string, unknown>) =>
          isTextColorToken(attributes.color)
            ? { [TEXT_COLOR_ATTR]: attributes.color }
            : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `span[${TEXT_COLOR_ATTR}]`,
        consuming: false,
        getAttrs: (element) => (tokenOf(element) ? null : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },

  addCommands() {
    return {
      setTextColor:
        (token) =>
        ({ commands }) =>
          isTextColorToken(token)
            ? commands.setMark(this.name, { color: token })
            : false,
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    };
  },
});
