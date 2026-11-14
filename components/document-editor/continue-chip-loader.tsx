"use client";

import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { EditorState } from "@tiptap/pm/state";
import { useEffect, useState } from "react";

import type { ContinueChipProps } from "@/components/document-editor/continue-chip";
import { lazySurface } from "@/components/smart-toolbar/lazy-surface";
import { headingFilterPluginKey } from "@/extensions/heading-filter";
import { findTocAnchor } from "@/extensions/table-of-contents";
import { goToHeading } from "@/lib/heading-navigation";

/**
 * What the lazy chip needs from the editor chunk, handed over as a prop:
 * a module both chunks import is split out of the editor group, which
 * costs it about 1.6 KB gz (measured; the contract's continue amendment).
 */
export interface ContinueNav {
  find: typeof findTocAnchor;
  /** A heading filter is on and hides this section. */
  isFilteredOut: (state: EditorState, id: string) => boolean;
  goTo: typeof goToHeading;
  /** A transaction from a collaborator (y-sync), not this writer. */
  isRemote: typeof isChangeOrigin;
}

export const CONTINUE_NAV: ContinueNav = {
  find: findTocAnchor,
  isFilteredOut: (state, id) => {
    const filter = headingFilterPluginKey.getState(state);
    return (
      !!filter && filter.slugs.length > 0 && !filter.matchedSectionIds.has(id)
    );
  },
  goTo: goToHeading,
  isRemote: isChangeOrigin,
};

const LazyContinueChip = lazySurface(() =>
  import("@/components/document-editor/continue-chip").then(
    (module) => module.ContinueChip,
  ),
);

/**
 * "Continue where you left off" (spec M15): loads the chip and its
 * recorder when the browser is first idle after the editor mounts. A chunk
 * that fails to load shows nothing; the editor is unaffected.
 */
export function ContinueChipLoader(props: Omit<ContinueChipProps, "nav">) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const ready = () => setIdle(true);
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(ready);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(ready, 1000);
    return () => window.clearTimeout(id);
  }, []);
  return idle ? <LazyContinueChip {...props} nav={CONTINUE_NAV} /> : null;
}
