import type { Editor } from "@tiptap/core";

import { findTocAnchor } from "@/extensions/table-of-contents";

/** How long a smooth scroll may run before its settle pass is dropped. */
const SCROLL_SETTLE_TIMEOUT_MS = 5000;
const SCROLL_TAKEOVER_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "pointerdown",
];

export type ScrollBlock = "start" | "center";

/**
 * Scrolls a top-level block into view (smoothly unless the user prefers
 * reduced motion), then settles it there. Blocks off screen are laid out
 * with estimated heights (`content-visibility: auto`) and diagrams render
 * lazily, so the page can change height under a long scroll and stop it
 * short; when the scroll ends, the block is aligned again without
 * animation. The settle pass is dropped if the user takes over or no
 * scroll ends in time.
 */
export function scrollBlockIntoView(dom: HTMLElement, block: ScrollBlock) {
  const settle = new AbortController();
  const options = { capture: true, signal: settle.signal };
  const cancel = () => settle.abort();
  document.addEventListener(
    "scrollend",
    (event) => {
      if (!(event.target instanceof Node) || !event.target.contains(dom)) {
        return;
      }
      cancel();
      dom.scrollIntoView({ block });
    },
    options,
  );
  for (const type of SCROLL_TAKEOVER_EVENTS) {
    document.addEventListener(type, cancel, options);
  }
  window.setTimeout(cancel, SCROLL_SETTLE_TIMEOUT_MS);
  const reduce = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  dom.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
}

/**
 * Goes to a heading the way an outline pick does (AGENTS.md): unfolds the
 * sections hiding it, puts the caret at the end of the heading, focuses the
 * editor, and scrolls the heading to `block` one frame later, once the
 * selection and focus have settled (the caret's block then renders at its
 * true height). The heading is looked up by id each time, never by a
 * stored position. False when it is gone. Shared by the outline and the
 * "Continue where you left off" chip.
 */
export function goToHeading(
  editor: Editor,
  id: string,
  block: ScrollBlock,
): boolean {
  const anchor = findTocAnchor(editor.state.doc, id);
  if (!anchor) return false;
  editor.commands.unfoldAncestors(id);
  editor.commands.setTextSelection(anchor.pos + anchor.node.nodeSize - 1);
  editor.commands.focus();
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    const current = findTocAnchor(editor.state.doc, id);
    const dom = current && editor.view.nodeDOM(current.pos);
    if (dom instanceof HTMLElement) scrollBlockIntoView(dom, block);
  });
  return true;
}
