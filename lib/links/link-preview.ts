/**
 * The preview popover for document links (linking review decision 4;
 * search-linking §4.3 amended): a plain click or Mod-K on a `tinydocy:`
 * link while editing shows the target's title, its folder path (or the
 * §4.6 state), and [Open] [Copy Link] [Remove Link]. It never shows the
 * href or the key, and document links have no Edit. Web links keep the
 * Hyperlink package's own popovers. Built in the host's chunk and passed to
 * the editor through `linkHost.popovers`.
 */
import {
  createHyperlinkPopover,
  editHyperlinkPopover,
  getDefaultController,
  type HyperlinkOptions,
  type PreviewHyperlinkOptions,
  previewHyperlinkPopover,
} from "@docs.plus/extension-hyperlink";
import type { Editor } from "@tiptap/core";

import { isOurScheme } from "@/lib/links/doc-link";
import { LINK_COPY, presentationOf } from "@/lib/links/link-copy";
import type { LinkState } from "@/lib/links/resolve";

export interface LinkPopoverDeps {
  resolve(href: string): LinkState | null;
  /** Follows the link through the host's `navigate`. */
  follow(href: string, newTab: boolean): void;
  /** Writes the link to the clipboard; the default uses the Clipboard API. */
  copyText?(text: string): Promise<void>;
}

type Popovers = NonNullable<HyperlinkOptions["popovers"]>;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Text in its own direction, as every title is (languages §4.6). */
function bdi(text: string): HTMLElement {
  const node = document.createElement("bdi");
  node.dir = "auto";
  node.textContent = text;
  return node;
}

/** The text of this document's heading `tocId`, if it exists. */
function headingText(editor: Editor, tocId: string): string | null {
  let found: string | null = null;
  editor.state.doc.forEach((node) => {
    if (found === null && node.attrs["data-toc-id"] === tocId) {
      found = node.textContent;
    }
  });
  return found;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = element(
    "button",
    `doc-link-preview-${label.toLowerCase().replace(" ", "-")}`,
    label,
  );
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

/** The card for one document link. */
export function docLinkPreview(
  options: Pick<PreviewHyperlinkOptions, "editor" | "attrs">,
  deps: LinkPopoverDeps,
): HTMLElement {
  const { editor } = options;
  const href = options.attrs.href ?? "";
  const state = deps.resolve(href) ?? ({ state: "unknown_form" } as const);
  const shown = presentationOf(state.state);
  const card = element("div", "hyperlink-preview-popover doc-link-preview");
  card.dataset.linkState = shown;

  const heading = element("p", "doc-link-preview-title");
  const body = element("p", "doc-link-preview-detail");
  let opens = false;
  switch (state.state) {
    case "resolves":
      opens = true;
      heading.append(bdi(state.title));
      body.append(bdi(["Library", ...state.path].join(" › ")));
      break;
    case "in_trash":
      opens = true;
      heading.append(bdi(state.title));
      body.textContent = "In Trash";
      break;
    case "here": {
      opens = true;
      heading.append(bdi(headingText(editor, state.tocId) ?? "This document"));
      body.textContent = "A section of this document";
      break;
    }
    case "deleted":
      body.textContent =
        shown === "deleted" ? LINK_COPY.deleted : LINK_COPY.notAvailable;
      break;
    case "not_in_library":
      body.textContent = LINK_COPY.notAvailable;
      break;
    case "unknown_form":
      body.textContent = LINK_COPY.unknownForm;
      break;
  }
  if (heading.childNodes.length > 0) card.append(heading);
  card.append(body);

  const actions = element("div", "doc-link-preview-actions");
  const close = () => getDefaultController().close();
  if (opens) {
    actions.append(
      button("Open", () => {
        close();
        deps.follow(href, false);
      }),
    );
  }
  actions.append(
    button("Copy Link", () => {
      const copy =
        deps.copyText ?? ((text) => navigator.clipboard.writeText(text));
      void copy(href).then(close, close);
    }),
  );
  if (editor.isEditable) {
    actions.append(
      button("Remove Link", () => {
        close();
        editor.chain().focus().unsetHyperlink().run();
      }),
    );
  }
  card.append(actions);
  return card;
}

/**
 * All three popovers (the `popovers` option replaces them together):
 * document links get `docLinkPreview` for both preview and edit, and web
 * links the package's own.
 */
export function createLinkPopovers(deps: LinkPopoverDeps): Popovers {
  return {
    previewHyperlink: (options) =>
      isOurScheme(options.attrs.href ?? "")
        ? docLinkPreview(options, deps)
        : previewHyperlinkPopover(options),
    editHyperlink: (options) => {
      const href = options.link.getAttribute("href") ?? "";
      return isOurScheme(href)
        ? docLinkPreview(
            {
              editor: options.editor,
              attrs: { href } as PreviewHyperlinkOptions["attrs"],
            },
            deps,
          )
        : editHyperlinkPopover(options);
    },
    createHyperlink: (options) => createHyperlinkPopover(options),
  };
}
