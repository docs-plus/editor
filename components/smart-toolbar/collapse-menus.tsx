"use client";

import type { SurfaceProps } from "./types";

/*
 * Responsive ladder stand-ins (spec §4.6), shown by container queries at
 * their tier. PR D2 owns; PR D1's row renders each next to the group it
 * replaces. SKELETON: render nothing until D2.
 */

/** T3: align + indent → ¶ menu. */
export function ParagraphCollapseMenu(_props: SurfaceProps) {
  return null;
}

/** T3: context slot → one 40px button. */
export function SlotCollapseButton(_props: SurfaceProps) {
  return null;
}

/** T4: colour pair → one button. */
export function ColorCollapseButton(_props: SurfaceProps) {
  return null;
}

/** T4: Outline + Filter → View ▾. */
export function ViewCollapseMenu(_props: SurfaceProps) {
  return null;
}

/** T5: U, S → "Aa" menu. */
export function AaCollapseMenu(_props: SurfaceProps) {
  return null;
}
