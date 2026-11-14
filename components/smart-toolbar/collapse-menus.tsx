"use client";

import { useCallback, useRef } from "react";

import { useActionView } from "@/hooks/use-editor-context";
import {
  FONT_SIZE_LABELS,
  FONT_SIZE_SHORT,
} from "@/lib/editor-actions/surface-actions";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import {
  BaselineIcon,
  ChevronDownIcon,
  PanelLeftIcon,
  PilcrowIcon,
  SlidersHorizontalIcon,
  TypeIcon,
} from "@/lib/icons";
import { FONT_SIZE_LADDER, type FontSizeStep } from "@/lib/text-style-tokens";

import { ColorPopoverButton } from "./color-controls";
import { SLOT_LABELS } from "./context-slot/context-slot";
import { useSlotTarget } from "./context-slot/use-slot-target";
import { menuBody } from "./lazy-menu";
import { ToolbarMenu, useMenuFocus, useSurfaceEditor } from "./row/action-menu";
import type { SurfaceProps } from "./types";

/* Each stand-in's items are in the menu chunk (`collapse-menu-bodies.tsx`). */
const SizeMenuItems = menuBody((bodies) => bodies.SizeMenuItems);
const ParagraphMenuItems = menuBody((bodies) => bodies.ParagraphMenuItems);
const SlotMenuItems = menuBody((bodies) => bodies.SlotMenuItems);
const ViewMenuItems = menuBody((bodies) => bodies.ViewMenuItems);
const AaMenuItems = menuBody((bodies) => bodies.AaMenuItems);

/*
 * Responsive ladder stand-ins (spec §4.6). Each renders inside a
 * `data-collapse-standin` wrapper that `smart-toolbar.scss` shows only at
 * its tier, while the group it replaces (`data-collapse-tier`) is hidden.
 * Hidden items fail `checkVisibility()`, so roving focus skips them.
 */

const isReadOnly = (enabled: true | { reason: string } | undefined) =>
  enabled !== undefined &&
  enabled !== true &&
  enabled.reason === READ_ONLY_REASON;

/** T2: size stepper → "M ▾" (spec §4.6). */
export function SizeCollapseMenu({ editor: provided }: SurfaceProps) {
  const editor = useSurfaceEditor(provided);
  const view = useActionView("size.set", editor);
  const menu = useMenuFocus(editor);
  if (!editor || !view) return null;
  const step = (
    (FONT_SIZE_LADDER as readonly string[]).includes(view.value ?? "")
      ? view.value
      : "md"
  ) as FontSizeStep;
  return (
    <ToolbarMenu
      label={`Font size: ${FONT_SIZE_LABELS[step]}`}
      tooltip="Font size"
      readOnly={isReadOnly(view.enabled)}
      icon={<span aria-hidden="true">{FONT_SIZE_SHORT[step]}</span>}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="Font size"
    >
      <SizeMenuItems editor={editor} value={step} onPicked={menu.markPicked} />
    </ToolbarMenu>
  );
}

/** T3: align + indent → ¶ menu. */
export function ParagraphCollapseMenu({ editor: provided }: SurfaceProps) {
  const editor = useSurfaceEditor(provided);
  const view = useActionView("align.left", editor);
  const menu = useMenuFocus(editor);
  if (!editor || !view) return null;
  return (
    <ToolbarMenu
      label="Paragraph"
      tooltip="Alignment and indent"
      readOnly={isReadOnly(view.enabled)}
      icon={<PilcrowIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="Paragraph"
    >
      <ParagraphMenuItems
        editor={editor}
        value={view.value ?? "left"}
        onPicked={menu.markPicked}
      />
    </ToolbarMenu>
  );
}

const SLOT_ITEMS: Partial<Record<string, readonly string[]>> = {
  heading: ["section.fold", "section.moveUp", "section.moveDown"],
  code: ["code.copy"],
  mermaid: ["mermaid.copySource"],
  table: [
    "table.addRowBefore",
    "table.addRowAfter",
    "table.deleteRow",
    "table.addColumnBefore",
    "table.addColumnAfter",
    "table.deleteColumn",
    "table.toggleHeaderRow",
    "table.mergeOrSplit",
  ],
  media: ["media.options"],
};

/**
 * T3: the context slot → one 40px button with the slot's actions for the
 * current context. Nothing for paragraphs and lists (an empty slot).
 */
export function SlotCollapseButton({ editor: provided }: SurfaceProps) {
  const editor = useSurfaceEditor(provided);
  const { kind, headingId } = useSlotTarget(editor);
  const menu = useMenuFocus(editor);
  const ids = SLOT_ITEMS[kind];
  const label = SLOT_LABELS[kind];
  if (!editor || !ids || !label) return null;
  return (
    <ToolbarMenu
      label={label}
      tooltip={label}
      readOnly={!editor.isEditable}
      icon={<SlidersHorizontalIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel={label}
    >
      <SlotMenuItems
        editor={editor}
        kind={kind}
        ids={ids}
        headingId={headingId}
        onPicked={menu.markPicked}
      />
    </ToolbarMenu>
  );
}

/** T4: colour pair → one button that opens the colour popover. */
export function ColorCollapseButton({ editor: provided }: SurfaceProps) {
  const editor = useSurfaceEditor(provided);
  const view = useActionView("color.text.apply", editor);
  if (!editor || !view) return null;
  const reason = view.enabled === true ? undefined : view.enabled.reason;
  return (
    <ColorPopoverButton
      editor={editor}
      focusKind="text"
      label="Text and highlight colours"
      className="w-auto gap-0.5 px-1.5"
      reason={reason}
    >
      <BaselineIcon aria-hidden="true" />
      <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
    </ColorPopoverButton>
  );
}

interface ViewCollapseMenuProps {
  onTocToggle: () => void;
  onFilterToggle: () => void;
  tocVisible: boolean;
  /** Opening the outline overlay moves focus into it, not back here. */
  outlineOverlay?: boolean;
  filterActive: boolean;
}

/** T4: Outline + Filter → View ▾. */
export function ViewCollapseMenu({
  onTocToggle,
  onFilterToggle,
  tocVisible,
  outlineOverlay = false,
  filterActive,
}: ViewCollapseMenuProps) {
  const menu = useMenuFocus(null);
  const openingOverlay = useRef(false);
  const menuFinalFocus = menu.finalFocus;
  const finalFocus = useCallback(() => {
    if (!openingOverlay.current) return menuFinalFocus();
    openingOverlay.current = false;
    return false;
  }, [menuFinalFocus]);
  return (
    <ToolbarMenu
      label="View"
      tooltip="View"
      readOnly={false}
      icon={<PanelLeftIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={finalFocus}
      contentLabel="View"
    >
      <ViewMenuItems
        tocVisible={tocVisible}
        filterActive={filterActive}
        onTocToggle={() => {
          openingOverlay.current = outlineOverlay && !tocVisible;
          onTocToggle();
        }}
        onFilterToggle={onFilterToggle}
      />
    </ToolbarMenu>
  );
}

/** T5: U, S → "Aa" menu. */
export function AaCollapseMenu({ editor: provided }: SurfaceProps) {
  const editor = useSurfaceEditor(provided);
  const view = useActionView("mark.underline", editor);
  const menu = useMenuFocus(editor);
  if (!editor || !view) return null;
  return (
    <ToolbarMenu
      label="More text formatting"
      tooltip="Underline and strikethrough"
      readOnly={isReadOnly(view.enabled)}
      icon={<TypeIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="More text formatting"
    >
      <AaMenuItems editor={editor} onPicked={menu.markPicked} />
    </ToolbarMenu>
  );
}
