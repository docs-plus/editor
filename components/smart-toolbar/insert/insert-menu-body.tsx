"use client";

import { type Editor, useCurrentEditor } from "@tiptap/react";

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuReason,
} from "@/components/ui/dropdown-menu";
import { useEditorContext } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { AnyAction } from "@/lib/editor-actions/types";
import {
  INSERT_KIND_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";

import { lazySurface, loadInsertStep } from "../lazy-surface";

/*
 * `+ Insert ▾`'s popup and items (menu chunk, `menu-bodies.ts`); the
 * trigger, its face and the steps are `insert-menu.tsx`.
 */

/**
 * Diagram ▸, the Mermaid templates submenu (M17b, design pass §9). It
 * rides in the insert step's chunk, which the Insert button preloads on
 * hover and focus. Until it loads, or if it fails, Diagram is one item
 * that inserts the last used template.
 */
const DiagramTemplates = lazySurface(
  () => loadInsertStep().then((module) => module.DiagramTemplates),
  <DiagramItem />,
);

function DiagramItem() {
  const { editor } = useCurrentEditor();
  const action = editorActions.get("insert.mermaid");
  const Icon = action?.icon;
  return editor && action ? (
    <DropdownMenuItem
      data-action-id={action.id}
      onClick={() => runAction(editor, action)}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{action.label}</span>
    </DropdownMenuItem>
  ) : null;
}

/** "insert.codeBlock" → "codeBlock", the M10 kind ("" for other groups). */
const kindOf = (action: AnyAction) =>
  action.id.startsWith("insert.") ? action.id.slice(7) : "";

/**
 * The menu items: mounted only while the menu is open, so the snapshot
 * subscription costs nothing while typing. E's `template.*` actions are
 * no rows of their own: Diagram is a submenu of them (design pass §9).
 */
function InsertMenuItems({ editor }: { editor: Editor }) {
  const ctx = useEditorContext(editor);
  const lastKind = useRememberedChoice(INSERT_KIND_CHOICE);
  return editorActions.list({ group: "insert" }).map((action) => {
    const kind = kindOf(action);
    if (!kind) return null;
    const enabled = ctx ? availability(action, ctx) : true;
    const reason = enabled === true ? undefined : enabled.reason;
    const Icon = action.icon;
    return kind === "mermaid" ? (
      <DiagramTemplates
        key={kind}
        editor={editor}
        ctx={ctx}
        last={lastKind.ready && kind === lastKind.last}
        fallback={<DiagramItem />}
      />
    ) : (
      <DropdownMenuItem
        key={action.id}
        data-action-id={action.id}
        data-last={lastKind.ready && kind === lastKind.last ? "" : undefined}
        disabled={reason !== undefined}
        aria-describedby={reason ? `${action.id}-reason` : undefined}
        onClick={() => runAction(editor, action)}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
        <span>{action.label}</span>
        {reason ? (
          <DropdownMenuReason id={`${action.id}-reason`} className="ps-5.5">
            {reason}
          </DropdownMenuReason>
        ) : null}
      </DropdownMenuItem>
    );
  });
}

/** The Insert menu's popup: every registry action in group `insert`. */
export function InsertMenuContent({ editor }: { editor: Editor }) {
  return (
    <DropdownMenuContent align="start" className="min-w-44">
      <InsertMenuItems editor={editor} />
    </DropdownMenuContent>
  );
}
