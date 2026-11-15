/**
 * What Paint format shows while armed (design pass §2, §5): the copy
 * cursor's class and the pill. Shared by the lazy engine
 * (`paint-format.ts`) and the brushes' pending press (`paint-pending.ts`,
 * before the engine lands), so the two states look the same. Constants
 * only: importing this never pulls the engine in.
 */

/** On the editor's `EditorContent` element (ProseMirror owns `view.dom`'s class). */
export const PAINTING_CLASS = "is-painting";

export const PAINT_PILLS = {
  pointer: "Select text to paint · Esc to cancel",
  touch: "Select text, then tap the brush again",
  applied: "Formatting applied",
} as const;
