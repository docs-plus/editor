/**
 * The Hyperlink `linkIcon` resolver for document links (search-linking
 * §4.6): one lucide icon per link presentation (`presentationOf`), built
 * as plain DOM because the extension renders it outside React. External
 * links get no icon (and so no network). States that don't open carry
 * `role="img"` and an `aria-label` (`LINK_STATE_LABEL`), so the state
 * prefixes the link's accessible name; the others stay `aria-hidden`. The
 * dashed underline for broken states is CSS keyed on `data-link-state`
 * (`DASHED_LINK_STATES`), never colour alone.
 */
import type { LinkIconResolver } from "@docs.plus/extension-hyperlink";

import { isOurScheme } from "@/lib/links/doc-link";
import {
  LINK_STATE_LABEL,
  type LinkPresentation,
  presentationOf,
} from "@/lib/links/link-copy";
import type { LinkState } from "@/lib/links/resolve";

/** lucide's own shape: `[tag, attributes]` per SVG child. */
type IconNode = readonly (readonly [
  tag: "path" | "line",
  attrs: Readonly<Record<string, string>>,
])[];

/**
 * SVG children copied from lucide-react v1.72.0 (ISC), the version
 * `lib/icons.tsx` renders; `tests/unit/lib/links/lucide-drift.test.ts`
 * fails when an upgrade redraws one. In that version `FileQuestion` is the
 * `file-question-mark` icon. Copied, not imported: the
 * `lucide-react/icons/*` modules pull in React and type only their default
 * export.
 */
const FILE_OUTLINE = [
  "path",
  {
    d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
  },
] as const;
const FILE_FOLD = ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }] as const;

const FILE_TEXT: IconNode = [
  FILE_OUTLINE,
  FILE_FOLD,
  ["path", { d: "M10 9H8" }],
  ["path", { d: "M16 13H8" }],
  ["path", { d: "M16 17H8" }],
];
const FILE_MINUS: IconNode = [
  FILE_OUTLINE,
  FILE_FOLD,
  ["path", { d: "M9 15h6" }],
];
const FILE_QUESTION: IconNode = [
  FILE_OUTLINE,
  ["path", { d: "M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5" }],
  ["path", { d: "M12 17h.01" }],
];
const HASH: IconNode = [
  ["line", { x1: "4", x2: "20", y1: "9", y2: "9" }],
  ["line", { x1: "4", x2: "20", y1: "15", y2: "15" }],
  ["line", { x1: "10", x2: "8", y1: "3", y2: "21" }],
  ["line", { x1: "16", x2: "14", y1: "3", y2: "21" }],
];

/**
 * In Trash keeps the file shape (`FileMinus`, Q5): a trash can mid-sentence
 * reads as a delete button. Not available (Q4), invalid and later forms
 * share `FileQuestion`; the label and the preview tell them apart.
 */
const ICONS: Record<LinkPresentation, IconNode> = {
  resolves: FILE_TEXT,
  here: HASH,
  in_trash: FILE_MINUS,
  not_available: FILE_QUESTION,
  invalid: FILE_QUESTION,
  unknown_form: FILE_QUESTION,
};

/** Presentations drawn with a dashed underline (§4.6). */
export const DASHED_LINK_STATES: ReadonlySet<LinkPresentation> = new Set([
  "not_available",
  "invalid",
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

/**
 * Sets every attribute that follows the state, and clears the ones that
 * don't apply, so creation and refresh agree in both directions. The
 * extension adds `role="img"` or `aria-hidden` once, when the link
 * renders, and never removes either.
 */
function applyPresentation(
  icon: HTMLElement,
  presentation: LinkPresentation,
): void {
  icon.dataset.linkState = presentation;
  const label = LINK_STATE_LABEL[presentation];
  if (label) {
    icon.removeAttribute("aria-hidden");
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", label);
  } else {
    icon.removeAttribute("role");
    icon.removeAttribute("aria-label");
    icon.setAttribute("aria-hidden", "true");
  }
}

function buildSvg(presentation: LinkPresentation): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries(SVG_ATTRS)) {
    svg.setAttribute(name, value);
  }
  for (const [tag, attrs] of ICONS[presentation]) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
      child.setAttribute(name, value);
    }
    svg.append(child);
  }
  return svg;
}

type GetLinkState = (href: string) => LinkState | null;

const svgs = new Map<LinkPresentation, SVGSVGElement>();

/** A fresh copy of the presentation's drawing (one template each). */
function svgFor(presentation: LinkPresentation): SVGSVGElement {
  let template = svgs.get(presentation);
  if (!template) {
    template = buildSvg(presentation);
    svgs.set(presentation, template);
  }
  return template.cloneNode(true) as SVGSVGElement;
}

/**
 * Ours but unresolved by the host still gets an icon, never a plain link:
 * it reads as invalid.
 */
const presentationFor = (
  getState: GetLinkState,
  href: string,
): LinkPresentation => presentationOf(getState(href)?.state ?? "invalid");

/**
 * `getState` resolves an href (`resolveDocLink` against the current
 * snapshot). Each call returns a fresh element with no text, as the
 * extension requires.
 */
export function createLinkIcon(getState: GetLinkState): LinkIconResolver {
  return ({ href }) => {
    if (!isOurScheme(href)) return null;
    const presentation = presentationFor(getState, href);
    const icon = document.createElement("span");
    icon.className = "doc-link-icon";
    applyPresentation(icon, presentation);
    icon.append(svgFor(presentation));
    return icon;
  };
}

/**
 * Redraws the document-link icons under `root` (an editor's `view.dom`)
 * for the current index, in place: state, aria and drawing. The extension's
 * mark view draws the icon once and keeps it until the href changes, so a
 * rename, trash or restore leaves it stale; it ignores DOM changes inside
 * the icon, so mutating the icon needs no transaction and no re-render.
 * Returns how many icons changed.
 */
export function refreshLinkIcons(
  root: ParentNode,
  getState: GetLinkState,
): number {
  let changed = 0;
  for (const icon of root.querySelectorAll<HTMLElement>(".doc-link-icon")) {
    const href = icon.closest("a[href]")?.getAttribute("href");
    if (!href || !isOurScheme(href)) continue;
    const presentation = presentationFor(getState, href);
    if (icon.dataset.linkState === presentation) continue;
    applyPresentation(icon, presentation);
    icon.replaceChildren(svgFor(presentation));
    changed++;
  }
  return changed;
}
