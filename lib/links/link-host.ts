/**
 * Assembles the `LinkHost` a host hands the editor (search-linking §4.1):
 * the `tinydocy:` protocol, the write gate, `navigate` (§4.3) and the state
 * icon (§4.6). Lives in the host's lazy chunk; the editor only passes the
 * object through. `host` keeps its identity for the life of the host (the
 * editor memoizes on it), and reads the index lazily on every call.
 */
import {
  type IsAllowedUriContext,
  registerCustomProtocol,
} from "@docs.plus/extension-hyperlink";

import type { ScrollBlock } from "@/lib/heading-navigation";
import { isOurScheme, parseDocLink } from "@/lib/links/doc-link";
import { trackLinkGestures } from "@/lib/links/gestures";
import type { LinkHost } from "@/lib/links/link-host-types";
import { createLinkIcon, refreshLinkIcons } from "@/lib/links/link-icon";
import {
  createLinkNavigator,
  LINK_MESSAGES,
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
    | "onFollow"
  > {
  /** The current library snapshot (`LibraryIndex.snapshot()`). */
  getSnapshot(): LinkIndexSnapshot;
  /** Keys of purged documents, when the host knows any (`resolve.ts`). */
  purgedKeys?(): ReadonlySet<string>;
}

export const DOC_LINK_PROTOCOL = {
  scheme: "tinydocy",
  optionalSlashes: true,
} as const;

/**
 * Only valid document links can be written; every other href keeps the
 * extension's own policy, so web links behave as before.
 */
export function isAllowedLinkUri(
  uri: string,
  ctx: Pick<IsAllowedUriContext, "defaultValidate">,
): boolean {
  if (isOurScheme(uri)) return parseDocLink(uri) !== null;
  return ctx.defaultValidate(uri);
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
  // linkifyjs takes a custom scheme only before its first scan, and the
  // extension registers `protocols` in `onCreate`, which Tiptap runs on a
  // timer. Register now, so a host made before the first editor (at app
  // start) gets typed and pasted document links autolinked.
  registerCustomProtocol(
    DOC_LINK_PROTOCOL.scheme,
    DOC_LINK_PROTOCOL.optionalSlashes,
  );
  const gestures = trackLinkGestures(window);
  const resolve = (href: string) =>
    resolveDocLink(href, {
      snapshot: deps.getSnapshot(),
      purgedKeys: deps.purgedKeys?.(),
    });
  const host: LinkHost = Object.freeze({
    protocols: [DOC_LINK_PROTOCOL],
    isAllowedUri: isAllowedLinkUri,
    navigate: createLinkNavigator({
      resolve,
      openDocument: (docId, opts) => deps.openDocument(docId, opts),
      goToHeadingHere: (tocId) => deps.goToHeadingHere(tocId),
      openExternal: (href, opts) => deps.openExternal(href, opts),
      announce: (message) => deps.announce(message),
      wantsNewTab: gestures.wantsNewTab,
      onFollow: (event) => deps.onFollow?.(event),
    }),
    linkIcon: createLinkIcon(resolve),
  });
  return {
    host,
    refreshIcons: (root) => {
      refreshLinkIcons(root, resolve);
    },
    dispose: gestures.dispose,
  };
}

/**
 * After the target document's editor mounts, goes to the linked heading
 * (`goToHeading(editor, tocId, "start")`, §4.3); when the heading is gone
 * the document stays at the top and the pill says so (§4.4).
 */
export function openAtHeading<E>(
  editor: E,
  tocId: string,
  goToHeading: (editor: E, id: string, block: ScrollBlock) => boolean,
  announce: (message: string) => void,
): boolean {
  if (goToHeading(editor, tocId, "start")) return true;
  announce(LINK_MESSAGES.headingRemoved);
  return false;
}
