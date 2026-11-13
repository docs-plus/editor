import { builders as pmBuilders } from "prosemirror-test-builder";

import { createTestEditor } from "./create-test-editor";

const tempEditor = createTestEditor();
export const testSchema = tempEditor.schema;
tempEditor.destroy();

const built = pmBuilders(testSchema, {
  h1: { nodeType: "heading", level: 1 },
  h2: { nodeType: "heading", level: 2 },
  h3: { nodeType: "heading", level: 3 },
  h4: { nodeType: "heading", level: 4 },
  h5: { nodeType: "heading", level: 5 },
  h6: { nodeType: "heading", level: 6 },
});

export const doc = built.doc;
export const h1 = built.h1;
export const h2 = built.h2;
export const h3 = built.h3;
export const h4 = built.h4;
export const h5 = built.h5;
export const h6 = built.h6;
export const p = built.paragraph;
export const blockquote = built.blockquote;
export const codeBlock = built.codeBlock;
export const bulletList = built.bulletList;
export const listItem = built.listItem;
export const orderedList = built.orderedList;
export const taskList = built.taskList;
export const taskItem = built.taskItem;
export const hr = built.horizontalRule;
export const img = built.image;

/** Position of the first character of `text` inside the editor's document. */
export function posInside(
  editor: { state: { doc: import("prosemirror-model").Node } },
  text: string,
): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text)) {
      found = pos + (node.text?.indexOf(text) ?? 0);
    }
  });
  if (found === -1) throw new Error(`Text not found: ${text}`);
  return found;
}
