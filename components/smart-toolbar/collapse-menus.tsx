"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useRef } from "react";

import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { useActionView } from "@/hooks/use-editor-context";
import { CODE_LANGUAGES } from "@/lib/code-language";
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
import {
  ActionMenuItem,
  ActionRadioItem,
  DropdownMenuRadioGroup,
  ToolbarMenu,
  useMenuFocus,
  useSurfaceEditor,
} from "./row/action-menu";
import type { SurfaceProps } from "./types";

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
      <DropdownMenuRadioGroup value={step}>
        {FONT_SIZE_LADDER.map((size) => (
          <ActionRadioItem
            key={size}
            id="size.set"
            value={size}
            arg={size}
            label={FONT_SIZE_LABELS[size]}
            editor={editor}
            onPicked={menu.markPicked}
          />
        ))}
      </DropdownMenuRadioGroup>
    </ToolbarMenu>
  );
}

const ALIGN_VALUES = ["left", "center", "right", "justify"] as const;

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
      <DropdownMenuRadioGroup value={view.value ?? "left"}>
        {ALIGN_VALUES.map((align) => (
          <ActionRadioItem
            key={align}
            id={`align.${align}`}
            value={align}
            editor={editor}
            onPicked={menu.markPicked}
          />
        ))}
      </DropdownMenuRadioGroup>
      <ActionMenuItem
        id="indent.outdent"
        editor={editor}
        onPicked={menu.markPicked}
      />
      <ActionMenuItem
        id="indent.indent"
        editor={editor}
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

function SlotLanguageItems({
  id,
  editor,
  onPicked,
}: {
  id: "code.language" | "mermaid.language";
  editor: Editor;
  onPicked: () => void;
}) {
  const view = useActionView(id, editor);
  if (!view) return null;
  const current = CODE_LANGUAGES.find((option) => option.label === view.value);
  return (
    <DropdownMenuRadioGroup value={current?.value ?? ""}>
      {CODE_LANGUAGES.map((option) => (
        <ActionRadioItem
          key={option.value}
          id={id}
          value={option.value}
          arg={option.value}
          label={option.label}
          editor={editor}
          onPicked={onPicked}
        />
      ))}
    </DropdownMenuRadioGroup>
  );
}

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
  const language =
    kind === "code"
      ? "code.language"
      : kind === "mermaid"
        ? "mermaid.language"
        : null;
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
      {ids.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          arg={kind === "heading" ? headingId : undefined}
          onPicked={menu.markPicked}
        />
      ))}
      {language ? (
        <SlotLanguageItems
          id={language}
          editor={editor}
          onPicked={menu.markPicked}
        />
      ) : null}
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
  const finalFocus = useCallback(() => {
    if (!openingOverlay.current) return menu.finalFocus();
    openingOverlay.current = false;
    return false;
  }, [menu.finalFocus]);
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
      <ViewToggleItem
        label="Outline"
        checked={tocVisible}
        onToggle={() => {
          openingOverlay.current = outlineOverlay && !tocVisible;
          onTocToggle();
        }}
      />
      <ViewToggleItem
        label="Filter document"
        checked={filterActive}
        onToggle={onFilterToggle}
      />
    </ToolbarMenu>
  );
}

function ViewToggleItem({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <DropdownMenuCheckboxItem checked={checked} closeOnClick onClick={onToggle}>
      {label}
    </DropdownMenuCheckboxItem>
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
      <ActionMenuItem
        id="mark.underline"
        editor={editor}
        checkbox
        onPicked={menu.markPicked}
      />
      <ActionMenuItem
        id="mark.strike"
        editor={editor}
        checkbox
        onPicked={menu.markPicked}
      />
    </ToolbarMenu>
  );
}
