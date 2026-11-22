/**
 * The link policy for web links: `https:`, `http:` and `mailto:` only,
 * after leading whitespace. A scheme a browser would still read through
 * inner whitespace or a leading control (`ht\ttps:`) is refused: the safe
 * side. The Hyperlink extension's own check is a denylist, so an `ms-msdt:`
 * or `search-ms:` link would otherwise reach the OS. Shared by the editor
 * (`isAllowedUri`) and the document link host (`lib/links`), so the two
 * never drift; it imports nothing.
 */
export const isWebLink = (href: string): boolean =>
  /^\s*(https?|mailto):/i.test(href);
