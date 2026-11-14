"use client";

import type { Editor } from "@tiptap/react";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useActionView } from "@/hooks/use-editor-context";
import { CODE_LANGUAGES } from "@/lib/code-language";
import { FONT_SIZE_LABELS } from "@/lib/editor-actions/surface-actions";
import type { ContextKind } from "@/lib/editor-actions/types";
import { FONT_SIZE_LADDER } from "@/lib/text-style-tokens";

import { ActionMenuItem, ActionRadioItem } from "./row/menu-items";
import { AlignMenuItems } from "./row/row-menu-bodies";

/*
 * The ladder stand-ins' items (menu chunk, `menu-bodies.ts`); their
 * triggers are in `collapse-menus.tsx`.
 */

/** T2 "M ▾": the font size ladder. */
export function SizeMenuItems({
  editor,
  value,
  onPicked,
}: {
  editor: Editor;
  value: string;
  onPicked: () => void;
}) {
  return (
    <DropdownMenuRadioGroup value={value}>
      {FONT_SIZE_LADDER.map((size) => (
        <ActionRadioItem
          key={size}
          id="size.set"
          value={size}
          arg={size}
          label={FONT_SIZE_LABELS[size]}
          editor={editor}
          onPicked={onPicked}
        />
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** T3 ¶: alignment, then outdent and indent. */
export function ParagraphMenuItems({
  editor,
  value,
  onPicked,
}: {
  editor: Editor;
  value: string;
  onPicked: () => void;
}) {
  return (
    <>
      <AlignMenuItems editor={editor} value={value} onPicked={onPicked} inset />
      <ActionMenuItem id="indent.outdent" editor={editor} onPicked={onPicked} />
      <ActionMenuItem id="indent.indent" editor={editor} onPicked={onPicked} />
    </>
  );
}

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
  // The value is the language's name, aliases resolved (`js` is JavaScript).
  const current = CODE_LANGUAGES.find((option) => option.label === view.value);
  return (
    <DropdownMenuRadioGroup value={current?.value ?? ""}>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Language</DropdownMenuLabel>
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

/** T3 slot button: the current block's tools, then its language. */
export function SlotMenuItems({
  editor,
  kind,
  ids,
  headingId,
  onPicked,
}: {
  editor: Editor;
  kind: ContextKind;
  /** The kind's tools (`SLOT_ITEMS` in `collapse-menus.tsx`). */
  ids: readonly string[];
  headingId: string | null;
  onPicked: () => void;
}) {
  const language =
    kind === "code"
      ? "code.language"
      : kind === "mermaid"
        ? "mermaid.language"
        : null;
  return (
    <>
      {ids.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          arg={kind === "heading" ? headingId : undefined}
          onPicked={onPicked}
        />
      ))}
      {language ? (
        <SlotLanguageItems id={language} editor={editor} onPicked={onPicked} />
      ) : null}
    </>
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

/** T4 View ▾: Outline and Filter document. */
export function ViewMenuItems({
  tocVisible,
  filterActive,
  onTocToggle,
  onFilterToggle,
}: {
  tocVisible: boolean;
  filterActive: boolean;
  onTocToggle: () => void;
  onFilterToggle: () => void;
}) {
  return (
    <>
      <ViewToggleItem
        label="Outline"
        checked={tocVisible}
        onToggle={onTocToggle}
      />
      <ViewToggleItem
        label="Filter document"
        checked={filterActive}
        onToggle={onFilterToggle}
      />
    </>
  );
}

/** T5 "Aa": underline and strikethrough. */
export function AaMenuItems({
  editor,
  onPicked,
}: {
  editor: Editor;
  onPicked: () => void;
}) {
  return (
    <>
      <ActionMenuItem
        id="mark.underline"
        editor={editor}
        checkbox
        onPicked={onPicked}
      />
      <ActionMenuItem
        id="mark.strike"
        editor={editor}
        checkbox
        onPicked={onPicked}
      />
    </>
  );
}
