/**
 * The Hyperlink `navigate` option (search-linking §4.3, §4.4, §4.6). Every
 * `tinydocy:` href stops here and is never handed to `openExternal`
 * (`window.open`, `shell.openExternal`), whatever its form; web links pass
 * through unchanged.
 */
import { isOurScheme } from "@/lib/links/doc-link";
import type { LinkState } from "@/lib/links/resolve";

export const LINK_MESSAGES = {
  headingRemoved: "The section this link pointed to was removed.",
  deleted: "This document was deleted.",
  notInLibrary: "This links to a document that isn't in your library.",
  unknownForm: "This link needs a newer version of TinyDocy.",
} as const;

export interface LinkNavigatorDeps {
  resolve(href: string): LinkState | null;
  openDocument(
    docId: string,
    opts: { newTab: boolean; tocId: string | null },
  ): void;
  /** Goes to a heading in the open document; false when it is gone. */
  goToHeadingHere(tocId: string): boolean;
  openExternal(href: string, opts: { newTab: boolean }): void;
  announce(message: string): void;
  /** From `trackLinkGestures`: Shift held or the middle button. */
  wantsNewTab(): boolean;
  /**
   * A document link was followed (it opened a document or moved to a
   * heading here), so the shell can push a history entry for Back. Not
   * called when nothing moved.
   */
  onFollow?(event: { href: string; to: LinkState }): void;
}

export type LinkNavigator = (href: string, ctx: { newTab: boolean }) => void;

export function createLinkNavigator(deps: LinkNavigatorDeps): LinkNavigator {
  return (href, ctx) => {
    if (!isOurScheme(href)) {
      deps.openExternal(href, { newTab: ctx.newTab });
      return;
    }
    // A host that can't resolve one of ours reads it as a future form.
    const to = deps.resolve(href) ?? { state: "unknown_form" };
    switch (to.state) {
      case "resolves":
      case "in_trash":
        // In Trash opens too: the editor shows the In Trash banner (§4.4).
        deps.openDocument(to.docId, {
          // The extension's newTab means Mod or middle; Mod alone stays here.
          newTab: ctx.newTab && deps.wantsNewTab(),
          tocId: to.tocId,
        });
        break;
      case "here":
        if (!deps.goToHeadingHere(to.tocId)) {
          deps.announce(LINK_MESSAGES.headingRemoved);
          return;
        }
        break;
      case "deleted":
        deps.announce(LINK_MESSAGES.deleted);
        return;
      case "not_in_library":
        deps.announce(LINK_MESSAGES.notInLibrary);
        return;
      case "unknown_form":
        deps.announce(LINK_MESSAGES.unknownForm);
        return;
    }
    deps.onFollow?.({ href, to });
  };
}
