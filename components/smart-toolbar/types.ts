import type { Editor } from "@tiptap/react";

/** Props every smart-toolbar surface takes; falls back to the context editor. */
export interface SurfaceProps {
  editor?: Editor | null;
}
