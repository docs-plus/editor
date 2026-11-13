"use client";

import { ColorHighlightPopover } from "@/components/tiptap-ui/color-highlight-popover";

import type { SurfaceProps } from "./types";

/**
 * Row colour pair: text **A** split + highlight ✎ split, one shared popover
 * (spec §4.5, M1–M3). PR D2 owns. SKELETON: today's highlight popover.
 */
export function ColorControls({ editor }: SurfaceProps) {
  return <ColorHighlightPopover editor={editor} />;
}
