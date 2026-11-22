/**
 * Assembles the `LinkHost` a host hands the editor (search-linking §4.1):
 * the write gate, `navigate` (§4.3) and the state icon (§4.6). Lives in the
 * host's lazy chunk; the editor only passes the object through. `host`
 * keeps its identity for the life of the host (the editor memoizes on it),
 * and reads the index lazily on every call.
 *
 * No `protocols`: the extension's read and write gates take `tinydocy:`
 * through `isAllowedUri` alone, and `protocols` would only teach linkify
 * the scheme, so typed `tinydocy:` text would autolink. Document links are
 * made by the picker, and pasted ones arrive as HTML (LK2).
 */
import type { IsAllowedUriContext } from "@docs.plus/extension-hyperlink";
import type { Editor } from "@tiptap/core";

import { findTocAnchor } from "@/extensions/table-of-contents/table-of-contents-items";
import type { ScrollBlock } from "@/lib/heading-navigation";
import { isOurScheme, isWebLink, parseDocLink } from "@/lib/links/doc-link";
import { trackLinkGestures } from "@/lib/links/gestures";
import { LINK_COPY } from "@/lib/links/link-copy";
import type { LinkHost } from "@/lib/links/link-host-types";
import { createLinkIcon, refreshLinkIcons } from "@/lib/links/link-icon";
import { createLinkPopovers } from "@/lib/links/link-preview";
import {
  createLinkNavigator,
  type LinkNavigatorDeps,
} from "@/lib/links/navigate";
import { type LinkIndexSnapshot, resolveDocLink } from "@/lib/links/resolve";

export interface LinkHostDeps
  extends Pick<
    LinkNavigatorDeps,
    | "openDocument"
    | "goToHeadingHere"
    | "openExternal"
    | "announce"
    | "getSource"
    | "onFollow"
  > {
  /** The current library snapshot (`LibraryIndex.snapshot()`). */
  getSnapshot(): LinkIndexSnapshot;
  /** Keys of purged documents, when the host knows any (`resolve.ts`). */
  purgedKeys?(): ReadonlySet<string>;
}

/**
 * Only valid document links and web links (`isWebLink`: https, http,
 * mailto) can be written or opened; the extension's own safety gate still
 * runs as well.
 */
export function isAllowedLinkUri(
  uri: string,
  ctx: Pick<IsAllowedUriContext, "defaultValidate">,
): boolean {
  if (isOurScheme(uri)) return parseDocLink(uri) !== null;
  return isWebLink(uri) && ctx.defaultValidate(uri);
}

export interface LinkHostHandle {
  /** Created once; pass it to every editor as is. */
  readonly host: LinkHost;
  /**
   * Redraws the link icons under `root` (an editor's `view.dom`) after the
   * index changes; the extension only draws them when a link renders.
   */
  refreshIcons(root: ParentNode): void;
  dispose(): void;
}

export function createLinkHost(deps: LinkHostDeps): LinkHostHandle {
  const gestures = trackLinkGestures(window);
  const resolve = (href: string) =>
    resolveDocLink(href, {
      snapshot: deps.getSnapshot(),
      purgedKeys: deps.purgedKeys?.(),
    });
  const navigate = createLinkNavigator({
    resolve,
    openDocument: (docId, opts) => deps.openDocument(docId, opts),
    goToHeadingHere: (tocId) => deps.goToHeadingHere(tocId),
    openExternal: (href, opts) => deps.openExternal(href, opts),
    announce: (message) => deps.announce(message),
    wantsNewTab: gestures.wantsNewTab,
    lastAnchor: gestures.lastAnchor,
    getSource: () => deps.getSource?.() ?? null,
    // Only when the host listens: the source position costs a DOM read.
    onFollow: deps.onFollow && ((event) => deps.onFollow?.(event)),
  });
  const host: LinkHost = Object.freeze({
    isAllowedUri: isAllowedLinkUri,
    navigate,
    linkIcon: createLinkIcon(resolve),
    // Document links get their own preview (never the href or key); web
    // links keep the package's popovers.
    popovers: createLinkPopovers({
      resolve,
      follow: (href, newTab) => navigate(href, { newTab }),
    }),
  });
  return {
    host,
    refreshIcons: (root) => {
      refreshLinkIcons(root, resolve);
    },
    dispose: gestures.dispose,
  };
}

export interface OpenAtHeadingOptions {
  /** The target document's title, for "Opened Q4 budget, at Travel." */
  readonly title: string;
  /** `goToHeading` from `lib/heading-navigation` (injected for tests). */
  goToHeading(editor: Editor, id: string, block: ScrollBlock): boolean;
  announce(message: string): void;
  /**
   * Settles at the editor's first server sync. A heading missing from the
   * device copy is looked up once more after it before "section removed".
   */
  readonly waitForSync?: Promise<unknown>;
}

/**
 * After the target document's editor mounts, goes to the linked heading
 * (`goToHeading(editor, tocId, "start")`, §4.3) and makes the follow's one
 * announcement (§8): where it landed, or, when the heading is gone, that
 * the section was removed while the document stays at the top (§4.4). The
 * heading is looked up in the live document; one frame after
 * `goToHeading` scrolls, it is put at the top again, since lazily laid out
 * blocks above it can still change height. Announces nothing if the
 * editor is destroyed while it waits.
 */
export async function openAtHeading(
  editor: Editor,
  tocId: string,
  opts: OpenAtHeadingOptions,
): Promise<boolean> {
  let anchor = findTocAnchor(editor.state.doc, tocId);
  if (!anchor && opts.waitForSync) {
    // A failed sync reads like a sync without the heading.
    await opts.waitForSync.catch(() => {});
    if (editor.isDestroyed) return false;
    anchor = findTocAnchor(editor.state.doc, tocId);
  }
  if (!anchor || !opts.goToHeading(editor, tocId, "start")) {
    opts.announce(LINK_COPY.headingRemoved);
    return false;
  }
  opts.announce(LINK_COPY.opened(opts.title, anchor.node.textContent.trim()));
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const current = findTocAnchor(editor.state.doc, tocId);
      const dom = current && editor.view.nodeDOM(current.pos);
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
    }),
  );
  return true;
}
