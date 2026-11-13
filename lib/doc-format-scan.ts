/**
 * "In this doc" (spec §5 M12): the colours and formats a document already
 * uses. Scanned on demand (menu or palette open), capped, never stored.
 */
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import {
  bundleKey,
  bundleOfMarks,
  type FormatBundle,
  setEntries,
} from "@/extensions/repeat-formatting/bundle";
import type { HighlightToken, TextColorToken } from "@/lib/text-style-tokens";

export const DOC_SCAN_MAX_TEXT_NODES = 5000;
export const DOC_SCAN_MAX_ENTRIES = 8;

export interface DocFormatScan {
  textColors: Set<TextColorToken>;
  highlights: Set<HighlightToken>;
  /** Set entries only, most characters first (ties: first occurrence). */
  bundles: FormatBundle[];
  /** True when the text-node cap stopped the walk. */
  truncated: boolean;
}

const QUALIFYING = new Set(["textColor", "highlight", "fontSize"]);

export function scanDocFormats(
  doc: ProseMirrorNode,
  limits: { maxTextNodes?: number; maxEntries?: number } = {},
): DocFormatScan {
  const maxTextNodes = limits.maxTextNodes ?? DOC_SCAN_MAX_TEXT_NODES;
  const maxEntries = limits.maxEntries ?? DOC_SCAN_MAX_ENTRIES;
  const textColors = new Set<TextColorToken>();
  const highlights = new Set<HighlightToken>();
  const totals = new Map<
    string,
    { bundle: FormatBundle; chars: number; order: number }
  >();
  let seen = 0;
  let truncated = false;
  doc.descendants((node) => {
    if (truncated) return false;
    if (!node.isText) return true;
    seen += 1;
    if (seen > maxTextNodes) {
      truncated = true;
      return false;
    }
    if (!node.marks.some((mark) => QUALIFYING.has(mark.type.name))) {
      return false;
    }
    const bundle = setEntries(bundleOfMarks(node.marks));
    if (bundle.textColor) textColors.add(bundle.textColor);
    if (bundle.highlight) highlights.add(bundle.highlight);
    if (!bundle.textColor && !bundle.highlight && !bundle.fontSize) {
      return false;
    }
    const key = bundleKey(bundle);
    const entry = totals.get(key);
    const chars = node.text?.length ?? 0;
    if (entry) entry.chars += chars;
    else totals.set(key, { bundle, chars, order: totals.size });
    return false;
  });
  const bundles = [...totals.values()]
    .sort((a, b) => b.chars - a.chars || a.order - b.order)
    .slice(0, maxEntries)
    .map((entry) => entry.bundle);
  return { textColors, highlights, bundles, truncated };
}
