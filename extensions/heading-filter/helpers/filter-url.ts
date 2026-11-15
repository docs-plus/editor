const FILTER_PARAM = "filter";
const MODE_PARAM = "mode";
const DELIMITER = "|";

/** A hand-typed link can hold a bare `%`; keep that slug as typed. */
function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/**
 * A link's words are each matched against every section, on load and again
 * on every edit, so a crafted link carrying thousands of them would stall
 * the reader's tab. Real filters are a few short words: keep the first 8
 * distinct ones, at most 64 characters each, and drop the rest.
 */
export const MAX_FILTER_WORDS = 8;
export const MAX_FILTER_WORD_LENGTH = 64;

/** Cut to the cap without splitting a surrogate pair, which cannot encode. */
function capLength(slug: string): string {
  const cut = slug.slice(0, MAX_FILTER_WORD_LENGTH);
  const last = cut.charCodeAt(MAX_FILTER_WORD_LENGTH - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export function decodeFilterParams(
  searchString: string,
): { slugs: string[]; mode: "or" | "and" } | null {
  const params = new URLSearchParams(searchString);
  const raw = params.get(FILTER_PARAM);
  if (!raw) return null;
  const slugs: string[] = [];
  for (const part of raw.split(DELIMITER)) {
    const slug = capLength(decodeSlug(part));
    if (slug && !slugs.includes(slug)) slugs.push(slug);
    if (slugs.length === MAX_FILTER_WORDS) break;
  }
  const mode = params.get(MODE_PARAM) === "and" ? "and" : "or";
  return slugs.length > 0 ? { slugs, mode } : null;
}

export function updateFilterUrl(slugs: string[], mode: "or" | "and"): void {
  const url = new URL(window.location.href);
  if (slugs.length === 0) {
    url.searchParams.delete(FILTER_PARAM);
    url.searchParams.delete(MODE_PARAM);
  } else {
    url.searchParams.set(
      FILTER_PARAM,
      slugs.map(encodeURIComponent).join(DELIMITER),
    );
    url.searchParams.set(MODE_PARAM, mode);
  }
  history.replaceState(null, "", url.toString());
}

export function readFilterUrl(): {
  slugs: string[];
  mode: "or" | "and";
} | null {
  if (typeof window === "undefined") return null;
  return decodeFilterParams(window.location.search);
}
