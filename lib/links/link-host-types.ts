/**
 * What a host (desktop, the web library) hands the editor so document links
 * work: the Hyperlink options for the `tinydocy:` scheme. `popovers`
 * replaces all three of the package's popovers at once (the editor spreads
 * this object shallowly), so a host passes all three. Types only: the
 * editor chunk imports this file with `import type`, and every value comes
 * from the host's own chunk (`createLinkHost`, search-linking §4.1; D23's
 * 60 B line is the editor's pass-through, nothing more).
 */
import type { HyperlinkOptions } from "@docs.plus/extension-hyperlink";

export type LinkHost = Partial<
  Pick<
    HyperlinkOptions,
    "isAllowedUri" | "navigate" | "linkIcon" | "popovers" | "hovercard"
  >
>;
