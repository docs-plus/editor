/**
 * Links between documents (search-linking design §4.1). Three hrefs:
 * - `tinydocy:doc/<link_key>`: a document in your library;
 * - `tinydocy:doc/<link_key>#<data-toc-id>`: a heading in that document;
 * - `tinydocy:here#<data-toc-id>`: a heading in the document it sits in.
 *
 * `parseDocLink` is strict: anything else is not a document link. Routing
 * uses `isOurScheme`, which is loose on purpose: a `tinydocy:` href that
 * doesn't parse (a future form, odd case, stray whitespace) is still ours,
 * and must never reach `window.open` or `shell.openExternal`.
 */
export const DOC_LINK_SCHEME = "tinydocy";

const DOC_LINK =
  /^tinydocy:(?:doc\/([0-9a-f]{32})|(here))(?:#([0-9a-f-]{36}))?$/;

export type DocLink =
  | {
      readonly kind: "doc";
      readonly key: string;
      readonly tocId: string | null;
    }
  | { readonly kind: "here"; readonly tocId: string };

export function parseDocLink(href: string): DocLink | null {
  const match = DOC_LINK.exec(href);
  if (!match) return null;
  const [, key, here, tocId] = match;
  if (here) return tocId ? { kind: "here", tocId } : null;
  return { kind: "doc", key, tocId: tocId ?? null };
}

export function docHref(key: string, tocId?: string | null): string {
  return `${DOC_LINK_SCHEME}:doc/${key}${tocId ? `#${tocId}` : ""}`;
}

export function hereHref(tocId: string): string {
  return `${DOC_LINK_SCHEME}:here#${tocId}`;
}

/**
 * True for any href with our scheme, read the way a browser would: case
 * folded, with whitespace and control characters dropped (as the
 * Hyperlink extension's own safety gate does).
 */
export function isOurScheme(href: string): boolean {
  let folded = "";
  for (const char of href) {
    if (char.charCodeAt(0) > 0x20) folded += char.toLowerCase();
    if (folded.length > DOC_LINK_SCHEME.length) break;
  }
  return folded === `${DOC_LINK_SCHEME}:`;
}
