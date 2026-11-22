/**
 * Why a mark can't go on inline code: `inlineCode` excludes every other
 * mark (spec §7.2). Only lazy chunks read it (the bubble, the Paint format
 * engine), so it adds nothing to the editor chunk; the registry's own
 * reasons stay as they are.
 */
export const INLINE_CODE_REASON = "Inline code can't take other formatting.";
