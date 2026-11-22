/**
 * Links between documents (search-linking design §4.1). Three hrefs:
 * - `tinydocy:doc/<link_key>`: a document in your library;
 * - `tinydocy:doc/<link_key>#<data-toc-id>`: a heading in that document;
 * - `tinydocy:here#<data-toc-id>`: a heading in the document it sits in.
 *
 * `parseDocLink` is strict: anything else is not a document link. Routing
 * uses `isOurScheme`, which is loose on purpose: a `tinydocy:` href that
 * doesn't parse (a later form, odd case, stray whitespace) is still ours,
 * and must never reach `window.open` or `shell.openExternal`;
 * `classifyDocLink` says whether it is a later form or simply invalid.
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

/**
 * `later`: exactly lowercase `tinydocy:`, a kind this version doesn't know
 * (`[a-z][a-z0-9-]*`, not `doc` or `here`), then optionally `/`, `#` or `?`
 * and printable ASCII with no spaces, e.g. `tinydocy:folder/abc`.
 */
const LATER_FORM = /^tinydocy:([a-z][a-z0-9-]*)(?:[/#?][!-~]*)?$/;
const KNOWN_KINDS: ReadonlySet<string> = new Set(["doc", "here"]);

/**
 * What an href is to this version (search-linking §4.6): `valid` when it
 * parses; `later` when it is a form a newer TinyDocy may write ("needs a
 * newer version"); `invalid` otherwise: a known kind that doesn't parse
 * (`tinydocy:doc/BAD`), odd case, slashes, stray whitespace or bidi
 * characters, and any href that isn't ours.
 */
export type DocLinkClass = "valid" | "later" | "invalid";

export function classifyDocLink(href: string): DocLinkClass {
  if (parseDocLink(href)) return "valid";
  const kind = LATER_FORM.exec(href)?.[1];
  return kind && !KNOWN_KINDS.has(kind) ? "later" : "invalid";
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

/**
 * Web links the app may open or write: `https:`, `http:` and `mailto:`
 * only (an allowlist; the extension's own gate is a denylist that lets
 * `ms-msdt:`, `search-ms:`, `smb:` and the like through to the OS).
 * Whitespace is dropped first, as browsers drop it from a URL.
 */
export function isWebLink(href: string): boolean {
  return /^(?:https?|mailto):/i.test(href.replace(/\s/g, ""));
}
