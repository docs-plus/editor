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

/** Unicode white space (`\s`): NBSP, U+2028/U+2029, ideographic space, BOM. */
const WHITE_SPACE = /\s/;

/**
 * Characters an href can hide in its scheme: C0 controls, space and DEL;
 * Unicode white space; zero-width characters and marks (U+200B–U+200F);
 * bidi embeddings and overrides (U+202A–U+202E) and isolates
 * (U+2066–U+2069). Code points, not a regex: control characters in a regex
 * literal fail Biome.
 */
function isIgnorable(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code <= 0x20 ||
    code === 0x7f ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    WHITE_SPACE.test(char)
  );
}

/**
 * True for any href with our scheme, read loosely: case folded, with the
 * characters above dropped anywhere in it. That is a superset of what the
 * Hyperlink extension's own gate strips (C0 controls and space) and of
 * what a browser's URL parser drops (leading C0 controls and space, tabs
 * and newlines anywhere), so a `tinydocy:` href a person or a renderer
 * would read as ours can never be routed outward.
 */
export function isOurScheme(href: string): boolean {
  let folded = "";
  for (const char of href) {
    if (!isIgnorable(char)) folded += char.toLowerCase();
    if (folded.length > DOC_LINK_SCHEME.length) break;
  }
  return folded === `${DOC_LINK_SCHEME}:`;
}
