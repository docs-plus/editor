import { clampRemoteName, toRemoteCaretColor } from "@/lib/user-identity";

/** A collaborator's awareness state: anything another client sent. */
type RemoteUser = { name?: unknown; color?: unknown };

/**
 * Draws a collaborator's caret with the upstream DOM
 * (`selection-bubble-view.tsx` and `paragraph-node.scss` rely on the class
 * names), but validates the name and colour here, independently of
 * `@tiptap/extension-collaboration-caret`: the name is cleaned and cut to
 * 32 graphemes and inserted as text; a colour that is not `#rrggbb` is grey.
 */
export function renderCaret(user: RemoteUser): HTMLElement {
  const color = toRemoteCaretColor(user.color);
  const caret = document.createElement("span");
  caret.classList.add("collaboration-carets__caret");
  caret.style.borderColor = color;
  const label = document.createElement("div");
  label.classList.add("collaboration-carets__label");
  label.style.backgroundColor = color;
  const name = typeof user.name === "string" ? clampRemoteName(user.name) : "";
  label.append(document.createTextNode(name));
  caret.append(label);
  return caret;
}

/** The collaborator's selection highlight, as `@tiptap/y-tiptap` draws it. */
export function renderCaretSelection(user: RemoteUser): {
  style: string;
  class: "ProseMirror-yjs-selection";
} {
  return {
    style: `background-color: ${toRemoteCaretColor(user.color)}70`,
    class: "ProseMirror-yjs-selection",
  };
}
