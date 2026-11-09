import { common, createLowlight } from "lowlight";

const base = createLowlight(common);

/**
 * Lowlight with the 37 common grammars, minus auto-detection. A code block
 * without a language would otherwise run every grammar over its text on
 * each highlight pass; unlabelled blocks now render as plain text.
 */
export const lowlight: typeof base = {
  ...base,
  highlightAuto: (value) => base.highlight("plaintext", value),
};
