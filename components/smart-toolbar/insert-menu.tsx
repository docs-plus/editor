"use client";

import { type Editor, useCurrentEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

import { embedMedia } from "@/components/tiptap-ui/media-embed-popover";
import { MediaEmbedForm } from "@/components/tiptap-ui/media-embed-popover/media-embed-popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useEditorContext } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { AnyAction } from "@/lib/editor-actions/types";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";
import { ChevronDownIcon, PlusIcon } from "@/lib/icons";
import {
  INSERT_KIND_CHOICE,
  TABLE_SIZE_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";

import { TableSizeGrid } from "./insert/table-size-grid";
import type { SurfaceProps } from "./types";
import "./smart-toolbar.scss";

type Step = "table" | "embed";

const STEP_LABEL: Record<Step, string> = {
  table: "Insert table",
  embed: "Embed media",
};

/** "insert.codeBlock" → "codeBlock", the M10 kind. */
const kindOf = (action: AnyAction) => action.id.slice("insert.".length);

/**
 * The menu items: mounted only while the menu is open, so the snapshot
 * subscription costs nothing while typing.
 */
function InsertMenuItems({ editor }: { editor: Editor }) {
  const ctx = useEditorContext(editor);
  const lastKind = useRememberedChoice(INSERT_KIND_CHOICE);
  return editorActions.list({ group: "insert" }).map((action) => {
    const enabled = ctx ? availability(action, ctx) : true;
    const reason = enabled === true ? undefined : enabled.reason;
    const Icon = action.icon;
    return (
      <DropdownMenuItem
        key={action.id}
        data-action-id={action.id}
        data-last={
          lastKind.ready && kindOf(action) === lastKind.last ? "" : undefined
        }
        disabled={reason !== undefined}
        title={reason}
        onClick={() => runAction(editor, action)}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
        <span>{action.label}</span>
        {reason ? <span className="sr-only">({reason})</span> : null}
      </DropdownMenuItem>
    );
  });
}

/**
 * `+ Insert ▾` (spec §4.1): lists every registry action in group `insert`
 * (E's templates join that way). Kinds that need input first (table size,
 * embed link) answer the action's `insert.open` intent with their step
 * (M10), anchored to the Insert button. The table grid opens at the last
 * size (M17a); the last inserted kind is pre-highlighted. PR D2 owns.
 */
export function InsertMenu({ editor: providedEditor }: SurfaceProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = providedEditor ?? contextEditor ?? null;
  const tableSize = useRememberedChoice(TABLE_SIZE_CHOICE);
  const [step, setStep] = useState<Step | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editor) return;
    return onUiIntent(editor, (intent) => {
      if (intent.type !== "insert.open") return false;
      if (intent.kind !== "table" && intent.kind !== "embed") return false;
      const kind = intent.kind;
      // Let the menu close and hand focus back first.
      requestAnimationFrame(() => setStep(kind));
      return true;
    });
  }, [editor]);

  if (!editor) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <ToolbarButton
              ref={triggerRef}
              type="button"
              size="sm"
              className="st-insert-trigger"
              aria-label="Insert"
              tooltip="Insert"
              onMouseDown={(event) => event.preventDefault()}
            />
          }
        >
          <PlusIcon aria-hidden="true" />
          <span className="st-insert-label">Insert</span>
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <InsertMenuItems editor={editor} />
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover
        open={step !== null}
        onOpenChange={(open) => {
          if (!open) setStep(null);
        }}
      >
        <PopoverTrigger
          render={<span aria-hidden="true" className="st-insert-anchor" />}
        />
        <PopoverContent
          aria-label={step ? STEP_LABEL[step] : undefined}
          align="start"
          className={step === "embed" ? "w-80" : undefined}
          finalFocus={triggerRef}
        >
          {step === "table" ? (
            <TableSizeGrid
              initial={tableSize.last}
              onPick={(size) => {
                const action = editorActions.get("insert.table");
                if (action) runAction(editor, action, size);
                setStep(null);
                editor.commands.focus();
              }}
            />
          ) : null}
          {step === "embed" ? (
            <MediaEmbedForm
              onEmbed={(url) => embedMedia(editor, url)}
              onDone={() => setStep(null)}
            />
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  );
}
