/**
 * Command signatures of the `textColor` and `fontSize` marks (spec §3),
 * declared ahead of PR C so toolbar tracks compile against them. Type-only:
 * the marks are NOT registered anywhere until PR C ships them (with their
 * server allowlist entries first, spec §3.1). PR C may move this block into
 * its mark files but must keep the signatures.
 *
 * Semantics (PR C):
 * - one transaction; an empty selection sets a stored mark (inclusive marks);
 * - `setFontSize` returns false inside headings and the title;
 * - invalid tokens return false and change nothing.
 * Highlight keeps the stock `setHighlight({ color: HighlightToken })`.
 */
import type { FontSizeToken, TextColorToken } from "@/lib/text-style-tokens";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (token: TextColorToken) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
    fontSize: {
      setFontSize: (size: FontSizeToken) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}
