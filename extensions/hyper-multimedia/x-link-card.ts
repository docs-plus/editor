import {
  isSafeMediaSrc,
  isValidXUrl,
} from "@docs.plus/extension-hypermultimedia";
import type { NodeViewRenderer } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/** What the card can show without asking X: the URL itself. */
export interface XPostLink {
  href: string;
  /** `@handle` from the URL path, or null for `/i/status/…` links. */
  author: string | null;
  /** Host and path, for display. */
  label: string;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
/** Path segments X uses for its own pages, never a user handle. */
const NOT_A_HANDLE = new Set(["i", "intent", "home", "search", "share"]);

/**
 * Reads an X post URL into what the card shows. Only URLs the kit itself
 * accepts as X posts, with an http(s) scheme, qualify: anything else gets
 * no link out.
 */
export function describeXPost(src: unknown): XPostLink | null {
  if (typeof src !== "string" || !isValidXUrl(src) || !isSafeMediaSrc(src)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const [first = ""] = url.pathname.split("/").filter(Boolean);
  const author =
    HANDLE.test(first) && !NOT_A_HANDLE.has(first.toLowerCase())
      ? `@${first}`
      : null;
  return {
    href: url.href,
    author,
    label: `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`,
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** lucide `external-link`. */
const EXTERNAL_LINK_PATHS = [
  "M15 3h6v6",
  "M10 14 21 3",
  "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
];

function externalLinkIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "14",
    height: "14",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(name, value);
  }
  for (const d of EXTERNAL_LINK_PATHS) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** The kit's layout attributes, applied as its own X view applies them. */
function applyLayout(dom: HTMLElement, attrs: PMNode["attrs"]): void {
  const style: Record<string, unknown> = {
    display: attrs.display,
    float: attrs.float,
    clear: attrs.clear,
    margin: attrs.margin,
    justifyContent: attrs.justifyContent,
  };
  for (const [name, value] of Object.entries(style)) {
    dom.style.setProperty(
      name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
      value == null ? null : String(value),
    );
  }
  const width = Number(attrs.maxwidth);
  dom.style.width = Number.isFinite(width) && width > 0 ? `${width}px` : "";
}

/**
 * A button, not an anchor: the Hyperlink extension takes every click on an
 * `<a>` inside the editor for its own link popover. A new window is what
 * the desktop shell opens in the system browser.
 */
function openButton(href: string): HTMLButtonElement {
  const button = element("button", "x-link-card__open", "Open on X");
  button.type = "button";
  button.title = href;
  button.dataset.href = href;
  button.append(externalLinkIcon());
  button.addEventListener("click", () => {
    window.open(href, "_blank", "noopener,noreferrer");
  });
  return button;
}

function renderCard(frame: HTMLElement, src: unknown): void {
  const post = describeXPost(src);
  const body = element("div", "x-link-card__body");
  body.append(
    element("span", "x-link-card__badge", "X"),
    element(
      "span",
      "x-link-card__title",
      post?.author ? `Post by ${post.author}` : "Post on X",
    ),
  );
  if (post) {
    body.append(element("span", "x-link-card__url", post.label));
    frame.replaceChildren(body, openButton(post.href));
  } else {
    body.append(element("span", "x-link-card__url", "Unsupported link"));
    frame.replaceChildren(body);
  }
}

/**
 * Desktop view for the kit's `x` node: a static card built from the stored
 * URL alone. It never calls X's oEmbed endpoint or loads widgets.js (no X
 * script may run in the desktop app), and the node, its attributes and its
 * HTML stay the kit's, so a web client still shows the full embed.
 */
export const createXLinkCardView: NodeViewRenderer = ({ node }) => {
  // The host takes the kit's layout (its inline `display` and `width`); the
  // frame inside draws the card.
  const dom = element("div", "x-link-card");
  dom.contentEditable = "false";
  dom.dataset.xLinkCard = "";
  const frame = element("div", "x-link-card__frame");
  dom.append(frame);
  let current = node;
  applyLayout(dom, current.attrs);
  renderCard(frame, current.attrs.src);

  return {
    dom,
    update: (next) => {
      if (next.type !== current.type) return false;
      if (next.attrs.src !== current.attrs.src) {
        renderCard(frame, next.attrs.src);
      }
      applyLayout(dom, next.attrs);
      current = next;
      return true;
    },
    // Events on the open button are the button's (no node selection on a
    // click, no editor keys while it has focus); the rest are the editor's.
    stopEvent: (event) =>
      event.target instanceof Element &&
      event.target.closest(".x-link-card__open") !== null,
    ignoreMutation: () => true,
  };
};
