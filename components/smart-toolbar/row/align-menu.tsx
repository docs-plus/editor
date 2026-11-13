"use client";

import type { Editor } from "@tiptap/react";

import { useActionView } from "@/hooks/use-editor-context";
import type { TextAlign } from "@/lib/editor-actions/core/blocks";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
} from "@/lib/icons";

import {
  ActionRadioItem,
  DropdownMenuRadioGroup,
  ToolbarMenu,
  useMenuFocus,
  useSurfaceEditor,
} from "./action-menu";

const ALIGNS = [
  ["left", "Align left", AlignLeftIcon],
  ["center", "Align center", AlignCenterIcon],
  ["right", "Align right", AlignRightIcon],
  ["justify", "Justify", AlignJustifyIcon],
] as const;

/** Align ▾: icon-only, named by the current alignment ("Align left"). */
export function AlignMenu({ editor: provided }: { editor?: Editor | null }) {
  const editor = useSurfaceEditor(provided);
  const view = useActionView("align.left", editor);
  const menu = useMenuFocus(editor);
  if (!editor || !view) return null;
  const value = (view.value ?? "left") as TextAlign;
  const [, label, Icon] =
    ALIGNS.find(([align]) => align === value) ?? ALIGNS[0];
  const readOnly =
    view.enabled !== true && view.enabled.reason === READ_ONLY_REASON;
  return (
    <ToolbarMenu
      label={label}
      tooltip="Alignment"
      readOnly={readOnly}
      icon={<Icon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="Alignment"
    >
      <DropdownMenuRadioGroup value={value}>
        {ALIGNS.map(([align]) => (
          <ActionRadioItem
            key={align}
            id={`align.${align}`}
            value={align}
            editor={editor}
            onPicked={menu.markPicked}
          />
        ))}
      </DropdownMenuRadioGroup>
    </ToolbarMenu>
  );
}
