"use client";

import type { Editor } from "@tiptap/react";

import { useActionView } from "@/hooks/use-editor-context";
import { TEXT_STYLE_LABELS } from "@/lib/editor-actions/core/blocks";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";

import {
  ActionRadioItem,
  DropdownMenuRadioGroup,
  ToolbarMenu,
  useMenuFocus,
  useSurfaceEditor,
} from "./action-menu";

const STYLE_IDS = [
  ["style.paragraph", "paragraph"],
  ["style.heading1", "heading-1"],
  ["style.heading2", "heading-2"],
  ["style.heading3", "heading-3"],
  ["style.heading4", "heading-4"],
  ["style.heading5", "heading-5"],
  ["style.heading6", "heading-6"],
] as const;

const VALUE_BY_LABEL = new Map(
  Object.entries(TEXT_STYLE_LABELS).map(([value, label]) => [label, value]),
);

/** The T5 value: "H2", "Text", "Title", "Mixed". */
const shortStyle = (label: string) =>
  label.replace("Heading ", "H").replace("Normal text", "Text");

/**
 * Text style ▾ (spec §4.1): named by the current style ("Normal text",
 * "Heading 2", "Title", "Mixed"), shortened at T5. In the title every item
 * is disabled with "Title is always H1." Items are the `style.*` registry
 * actions.
 */
export function StyleMenu({ editor: provided }: { editor?: Editor | null }) {
  const editor = useSurfaceEditor(provided);
  const view = useActionView("style.paragraph", editor);
  const menu = useMenuFocus(editor);
  if (!editor || !view) return null;
  const label = view.value ?? TEXT_STYLE_LABELS.paragraph;
  const readOnly =
    view.enabled !== true && view.enabled.reason === READ_ONLY_REASON;
  return (
    <ToolbarMenu
      label={label}
      short={shortStyle(label)}
      tooltip="Text style"
      readOnly={readOnly}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="Text style"
    >
      <DropdownMenuRadioGroup value={VALUE_BY_LABEL.get(label) ?? ""}>
        {STYLE_IDS.map(([id, value]) => (
          <ActionRadioItem
            key={id}
            id={id}
            value={value}
            editor={editor}
            onPicked={menu.markPicked}
          />
        ))}
      </DropdownMenuRadioGroup>
    </ToolbarMenu>
  );
}
