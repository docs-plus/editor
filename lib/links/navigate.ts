/**
 * The Hyperlink `navigate` option (search-linking §4.3, §4.4, §4.6). Every
 * `tinydocy:` href stops here and is never handed to `openExternal`
 * (`window.open`, `shell.openExternal`), whatever its form; web links pass
 * through unchanged. Each follow of a document link makes one announcement
 * (§8): the state copy when it can't open, where it landed when it can
 * (`openAtHeading` speaks for a heading in another document).
 */
import type { Editor } from "@tiptap/core";
import {
  absolutePositionToRelativePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import type * as Y from "yjs";

import { findTocAnchor } from "@/extensions/table-of-contents/table-of-contents-items";
import { UNTITLED } from "@/lib/library/tree-rows";
import { isOurScheme, isWebLink } from "@/lib/links/doc-link";
import {
  LINK_COPY,
  MERGE_DELETED_INTO_NOT_AVAILABLE,
} from "@/lib/links/link-copy";
import type { LinkState } from "@/lib/links/resolve";

/** Where a followed link was: Back returns here. */
export interface FollowSource {
  readonly docId: string | null;
  /** The link's start in the source document, null without a Yjs binding. */
  readonly position: Y.RelativePosition | null;
}

export interface LinkFollow {
  readonly href: string;
  readonly to: LinkState;
  readonly source: FollowSource;
}

/** The document the link was followed from, and its editor. */
export interface LinkSourceEditor {
  readonly docId: string;
  readonly editor: Editor;
}

export interface LinkNavigatorDeps {
  resolve(href: string): LinkState | null;
  openDocument(
    docId: string,
    opts: { newTab: boolean; tocId: string | null; title: string },
  ): void;
  /** Goes to a heading in the open document; false when it is gone. */
  goToHeadingHere(tocId: string): boolean;
  openExternal(href: string, opts: { newTab: boolean }): void;
  announce(message: string): void;
  /** From `trackLinkGestures`: Shift held or the middle button. */
  wantsNewTab(): boolean;
  /** From `trackLinkGestures`: the link the gesture landed on. */
  lastAnchor?(): Element | null;
  /**
   * The open document, read before the follow moves anything. Without it,
   * `onFollow` gets a null source and a `here#` jump can't say where it
   * landed.
   */
  getSource?(): LinkSourceEditor | null;
  /**
   * A document link was followed (it opened a document or moved to a
   * heading here), so the shell can push a history entry for Back. Not
   * called when nothing moved.
   */
  onFollow?(event: LinkFollow): void;
}

export type LinkNavigator = (href: string, ctx: { newTab: boolean }) => void;

/** What a link that can't be followed says; null when it can be. */
function brokenMessage(to: LinkState): string | null {
  switch (to.state) {
    case "deleted":
      return MERGE_DELETED_INTO_NOT_AVAILABLE
        ? LINK_COPY.notAvailable
        : LINK_COPY.deleted;
    case "not_in_library":
      return LINK_COPY.notAvailable;
    case "unknown_form":
      return LINK_COPY.unknownForm;
    default:
      return null;
  }
}

/** The link's position: the clicked anchor, else the caret (keyboard). */
function linkPosition(editor: Editor, anchor: Element | null): number {
  const { view } = editor;
  if (anchor && view.dom.contains(anchor)) {
    try {
      return view.posAtDOM(anchor, 0);
    } catch {
      // Fall back to the caret.
    }
  }
  return editor.state.selection.from;
}

function relativePosition(
  editor: Editor,
  pos: number,
): Y.RelativePosition | null {
  const binding = ySyncPluginKey.getState(editor.state)?.binding;
  if (!binding?.type || !binding.mapping) return null;
  try {
    return absolutePositionToRelativePosition(
      pos,
      binding.type,
      binding.mapping,
    );
  } catch {
    return null; // Binding not synced yet.
  }
}

function followSource(
  source: LinkSourceEditor | null,
  anchor: Element | null,
): FollowSource {
  if (!source || source.editor.isDestroyed) {
    return { docId: source?.docId ?? null, position: null };
  }
  const { editor } = source;
  return {
    docId: source.docId,
    position: relativePosition(editor, linkPosition(editor, anchor)),
  };
}

function headingText(source: LinkSourceEditor | null, tocId: string) {
  if (!source || source.editor.isDestroyed) return null;
  const anchor = findTocAnchor(source.editor.state.doc, tocId);
  return anchor ? anchor.node.textContent.trim() || UNTITLED : null;
}

export function createLinkNavigator(deps: LinkNavigatorDeps): LinkNavigator {
  return (href, ctx) => {
    if (!isOurScheme(href)) {
      // The second check before anything leaves the app (the editor's
      // isAllowedUri is the first, main's IPC handler the third).
      if (isWebLink(href)) deps.openExternal(href, { newTab: ctx.newTab });
      return;
    }
    // A host that can't resolve one of ours reads it as a future form.
    const to = deps.resolve(href) ?? { state: "unknown_form" };
    const broken = brokenMessage(to);
    if (broken) {
      deps.announce(broken);
      return;
    }
    // Read the source before the follow replaces or moves it.
    const current = deps.getSource?.() ?? null;
    const source = deps.onFollow
      ? followSource(current, deps.lastAnchor?.() ?? null)
      : null;
    if (to.state === "here") {
      const heading = headingText(current, to.tocId);
      if (!deps.goToHeadingHere(to.tocId)) {
        deps.announce(LINK_COPY.headingRemoved);
        return;
      }
      if (heading) deps.announce(LINK_COPY.atHeading(heading));
    } else if (to.state === "resolves" || to.state === "in_trash") {
      // In Trash opens too: the editor shows the In Trash banner (§4.4).
      deps.openDocument(to.docId, {
        // The extension's newTab means Mod or middle; Mod alone stays here.
        newTab: ctx.newTab && deps.wantsNewTab(),
        tocId: to.tocId,
        title: to.title,
      });
      // With a heading, `openAtHeading` announces once it lands.
      if (!to.tocId) deps.announce(LINK_COPY.opened(to.title));
    }
    if (source) deps.onFollow?.({ href, to, source });
  };
}
