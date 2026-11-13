"use client";

import type { SurfaceProps } from "./types";

/**
 * Phone docked bar (< 768px, spec §4.7) with the Aa sheet. Renders
 * `PhoneSelectionCells` (E) in place of its cells while text is selected.
 * PR D2 owns and mounts it in `document-editor.tsx` (the `isMobile`
 * branch). SKELETON: renders nothing and is not mounted.
 */
export function PhoneBar(_props: SurfaceProps) {
  return null;
}
