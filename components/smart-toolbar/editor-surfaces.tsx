"use client";

import { CommandPaletteHost } from "./command-palette-host";
import { SelectionBubble } from "./selection-bubble";
import type { SurfaceProps } from "./types";

/**
 * Per-editor floating surfaces, mounted once inside `EditorContext` by
 * `document-editor.tsx`. Frozen file: D2 and E fill their components
 * instead of editing the editor shell.
 */
export function EditorSurfaces({ editor }: SurfaceProps) {
  return (
    <>
      <SelectionBubble editor={editor} />
      <CommandPaletteHost editor={editor} />
    </>
  );
}
