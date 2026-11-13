"use client";

import type { Editor } from "@tiptap/react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import {
  ActionMenuItem,
  DropdownMenuRadioGroup,
  ToolbarMenu,
  useMenuFocus,
} from "@/components/smart-toolbar/row/action-menu";
import { DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { useActionView } from "@/hooks/use-editor-context";
import { CODE_LANGUAGES } from "@/lib/code-language";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import {
  type ContextKind,
  type IconComponent,
  READ_ONLY_REASON,
} from "@/lib/editor-actions/types";
import { Columns3Icon, LockIcon, Rows3Icon } from "@/lib/icons";

/*
 * The context slot's controls (spec §4.2), a lazy chunk (owner decision
 * O1). `ContextSlot` keeps the group, its label and its width eager, so
 * the row never shifts while this loads.
 */

function LanguageMenu({
  id,
  editor,
  tooltip,
}: {
  id: "code.language" | "mermaid.language";
  editor: Editor;
  tooltip: string;
}) {
  const view = useActionView(id, editor);
  const menu = useMenuFocus(editor);
  const action = editorActions.get(id);
  if (!view || !action) return null;
  const label = view.value ?? "Plain text";
  const readOnly =
    view.enabled !== true && view.enabled.reason === READ_ONLY_REASON;
  const current = CODE_LANGUAGES.find((option) => option.label === label);
  return (
    <ToolbarMenu
      label={label}
      // The visible value may truncate; the tooltip keeps it whole.
      tooltip={`${tooltip}: ${label}`}
      triggerClassName="min-w-0 shrink max-w-[7.5rem]"
      readOnly={readOnly}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel={tooltip}
    >
      <DropdownMenuRadioGroup value={current?.value ?? ""}>
        {CODE_LANGUAGES.map((option) => (
          <DropdownMenuRadioItem
            key={option.value}
            value={option.value}
            closeOnClick
            onClick={() => {
              menu.markPicked();
              runAction(editor, action, option.value);
            }}
          >
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </ToolbarMenu>
  );
}

function ItemsMenu({
  label,
  ids,
  editor,
  icon: Icon,
}: {
  label: string;
  ids: readonly string[];
  editor: Editor;
  icon: IconComponent;
}) {
  const view = useActionView(ids[0], editor);
  const menu = useMenuFocus(editor);
  if (!view) return null;
  const readOnly =
    view.enabled !== true && view.enabled.reason === READ_ONLY_REASON;
  return (
    <ToolbarMenu
      label={label}
      tooltip={label}
      readOnly={readOnly}
      icon={<Icon aria-hidden="true" />}
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
          onPicked={menu.markPicked}
        />
      ))}
    </ToolbarMenu>
  );
}

export function SlotContents({
  kind,
  headingId,
  editor,
}: {
  kind: ContextKind;
  headingId: string | null;
  editor: Editor;
}) {
  switch (kind) {
    case "heading":
      // The held heading id travels as the argument: a move never lands on
      // another section when a collaborator deleted this one.
      return (
        <>
          <ActionButton id="section.fold" editor={editor} arg={headingId} />
          <ActionButton id="section.moveUp" editor={editor} arg={headingId} />
          <ActionButton id="section.moveDown" editor={editor} arg={headingId} />
        </>
      );
    case "title":
      return (
        <span className="flex items-center gap-1 px-2 text-xs text-muted-foreground">
          <LockIcon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Title is always H1.</span>
        </span>
      );
    case "code":
      return (
        <>
          <LanguageMenu
            id="code.language"
            editor={editor}
            tooltip="Code language"
          />
          <ActionButton id="code.copy" editor={editor} />
        </>
      );
    case "mermaid":
      return (
        <>
          <LanguageMenu
            id="mermaid.language"
            editor={editor}
            tooltip="Diagram language"
          />
          <ActionButton id="mermaid.copySource" editor={editor} />
        </>
      );
    case "table":
      return (
        <>
          <ItemsMenu
            label="Row"
            icon={Rows3Icon}
            editor={editor}
            ids={["table.addRowBefore", "table.addRowAfter", "table.deleteRow"]}
          />
          <ItemsMenu
            label="Column"
            icon={Columns3Icon}
            editor={editor}
            ids={[
              "table.addColumnBefore",
              "table.addColumnAfter",
              "table.deleteColumn",
            ]}
          />
          <ActionButton id="table.toggleHeaderRow" editor={editor} />
          <ActionButton id="table.mergeOrSplit" editor={editor} />
        </>
      );
    case "media":
      return <ActionButton id="media.options" editor={editor} />;
    default:
      return null;
  }
}
