/**
 * The Hyperlink `linkIcon` resolver for document links (search-linking
 * §4.6): one lucide icon per link state, built as plain DOM because the
 * extension renders it outside React. External links get no icon (and so
 * no network). The dashed underline for broken states is CSS keyed on
 * `data-link-state` (`DASHED_LINK_STATES`), never colour alone.
 */
import type { LinkIconResolver } from "@docs.plus/extension-hyperlink";

import { isOurScheme } from "@/lib/links/doc-link";
import type { LinkState, LinkStateName } from "@/lib/links/resolve";

type IconNode = readonly (readonly [tag: "path", d: string])[];

/**
 * SVG children copied from lucide-react v1.72.0 (ISC), the version
 * `lib/icons.tsx` renders. In that version `FileQuestion` is the
 * `file-question-mark` icon and `Trash2` an alias of `trash`. Copied, not
 * imported: the `lucide-react/icons/*` modules pull in React and type only
 * their default export.
 */
const FILE_OUTLINE =
  "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z";
const FILE_FOLD = "M14 2v5a1 1 0 0 0 1 1h5";

const FILE_TEXT: IconNode = [
  ["path", FILE_OUTLINE],
  ["path", FILE_FOLD],
  ["path", "M10 9H8"],
  ["path", "M16 13H8"],
  ["path", "M16 17H8"],
];
const FILE_X: IconNode = [
  ["path", FILE_OUTLINE],
  ["path", FILE_FOLD],
  ["path", "m14.5 12.5-5 5"],
  ["path", "m9.5 12.5 5 5"],
];
const FILE_QUESTION: IconNode = [
  ["path", FILE_OUTLINE],
  ["path", "M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5"],
  ["path", "M12 17h.01"],
];
const TRASH: IconNode = [
  ["path", "M10 11v6"],
  ["path", "M14 11v6"],
  ["path", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"],
  ["path", "M3 6h18"],
  ["path", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
];

const ICONS: Record<LinkStateName, IconNode> = {
  resolves: FILE_TEXT,
  here: FILE_TEXT,
  in_trash: TRASH,
  deleted: FILE_X,
  not_in_library: FILE_QUESTION,
  unknown_form: FILE_QUESTION,
};

/** States drawn with a dashed underline (§4.6). */
export const DASHED_LINK_STATES: ReadonlySet<LinkStateName> = new Set([
  "deleted",
  "not_in_library",
  "unknown_form",
]);

const SVG_NS = "http://www.w3.org/2000/svg";

const SVG_ATTRS: Record<string, string> = {
  xmlns: SVG_NS,
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  focusable: "false",
};

function buildIcon(state: LinkStateName): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "doc-link-icon";
  span.dataset.linkState = state;
  span.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries(SVG_ATTRS)) {
    svg.setAttribute(name, value);
  }
  for (const [tag, d] of ICONS[state]) {
    const child = document.createElementNS(SVG_NS, tag);
    child.setAttribute("d", d);
    svg.append(child);
  }
  span.append(svg);
  return span;
}

type GetLinkState = (href: string) => LinkState | null;

const templates = new Map<LinkStateName, HTMLSpanElement>();

function iconFor(state: LinkStateName): HTMLSpanElement {
  let template = templates.get(state);
  if (!template) {
    template = buildIcon(state);
    templates.set(state, template);
  }
  return template.cloneNode(true) as HTMLSpanElement;
}

/** Ours but unresolved by the host still gets an icon, never a plain link. */
const stateOf = (getState: GetLinkState, href: string): LinkStateName =>
  getState(href)?.state ?? "unknown_form";

/**
 * `getState` resolves an href (`resolveDocLink` against the current
 * snapshot). Each call returns a fresh element with no text, as the
 * extension requires: a clone of one template per state.
 */
export function createLinkIcon(getState: GetLinkState): LinkIconResolver {
  return ({ href }) =>
    isOurScheme(href) ? iconFor(stateOf(getState, href)) : null;
}

/**
 * Redraws the document-link icons under `root` (an editor's `view.dom`)
 * for the current index, in place. The extension's mark view draws the
 * icon once and keeps it until the href changes, so a rename, trash or
 * restore leaves it stale; it ignores DOM changes inside the icon, so
 * mutating the icon needs no transaction and no re-render. Returns how
 * many icons changed.
 */
export function refreshLinkIcons(
  root: ParentNode,
  getState: GetLinkState,
): number {
  let changed = 0;
  for (const icon of root.querySelectorAll<HTMLElement>(".doc-link-icon")) {
    const href = icon.closest("a[href]")?.getAttribute("href");
    if (!href || !isOurScheme(href)) continue;
    const state = stateOf(getState, href);
    if (icon.dataset.linkState === state) continue;
    icon.dataset.linkState = state;
    icon.replaceChildren(...iconFor(state).childNodes);
    changed++;
  }
  return changed;
}
