"use client";

import { type Editor, useCurrentEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuReason,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useEditorContext } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { AnyAction } from "@/lib/editor-actions/types";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";
import { ChevronDownIcon, PlusIcon } from "@/lib/icons";
import {
  INSERT_KIND_CHOICE,
  type InsertKind,
  TABLE_SIZE_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";
import { cn } from "@/lib/utils";

import type { InsertStepKind as Step } from "./insert/insert-step";
import { lazySurface, loadInsertStep, preloadSurfaces } from "./lazy-surface";
import type { SurfaceProps } from "./types";
import "./smart-toolbar.scss";

/**
 * The table grid and the embed form (owner decision O1): their own chunk,
 * fetched when the Insert button gets hover or focus, or when a step is
 * asked for, and rendered only once a step opens.
 */
const InsertStep = lazySurface(
  () => loadInsertStep().then((module) => module.InsertStep),
  undefined,
  ({ step }) => (step === "table" ? "the table picker" : "the embed form"),
);

/**
 * Diagram ▸, the Mermaid templates submenu (M17b, design pass §9). It
 * rides in the insert step's chunk, which the Insert button preloads on
 * hover and focus (editor-chunk budget: the submenu code stays out of the
 * editor chunk). Until it loads, or if it fails, Diagram is one item that
 * inserts the last used template.
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

const STEP_LABEL: Record<Step, string> = {
  table: "Insert table",
  embed: "Embed media",
};

/**
 * M10: the face's registry id, or null with nothing remembered (the face
 * then stays "+ Insert" and opens the menu, D2 Decision 1).
 */
const faceActionId = (kind: InsertKind | null) =>
  kind && editorActions.get(`insert.${kind}`) ? `insert.${kind}` : null;

/**
 * `+ Insert ▾` (spec §4.1): lists every registry action in group `insert`
 * (E's templates join that way). Kinds that need input first (table size,
 * embed link) answer the action's `insert.open` intent with their step
 * (M10), anchored to the Insert button. The table grid opens at the last
 * size (M17a); the last inserted kind is pre-highlighted. At T1 the last
 * kind also gets a labelled face beside the menu (M10). PR D2 owns.
 */
export function InsertMenu({ editor: providedEditor }: SurfaceProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = providedEditor ?? contextEditor ?? null;
  const tableSize = useRememberedChoice(TABLE_SIZE_CHOICE);
  const lastKind = useRememberedChoice(INSERT_KIND_CHOICE);
  const faceId = faceActionId(lastKind.ready ? lastKind.last : null);
  // The step stays rendered until the popover has finished closing: a
  // focused cell removed from a still-open popover makes Base UI pull focus
  // back into the popup, away from the editor a pick just focused.
  const [step, setStep] = useState<Step | null>(null);
  const [stepOpen, setStepOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stepPopupRef = useRef<HTMLDivElement>(null);

  /**
   * Base UI returns focus when the step unmounts, after its exit animation,
   * and moves it unconditionally for any `finalFocus` given. Back to the
   * trigger only while focus is still lost in the closing step (Esc): a
   * pick has focused the editor, and a click on another control in the
   * meantime has focused that control (or opened its menu, which focus
   * leaving would close).
   */
  const stepFinalFocus = useCallback(() => {
    const active = document.activeElement;
    const lost =
      !active ||
      active === document.body ||
      !active.isConnected ||
      Boolean(stepPopupRef.current?.contains(active));
    return lost ? (triggerRef.current ?? true) : false;
  }, []);

  useEffect(() => {
    if (!editor) return;
    return onUiIntent(editor, (intent) => {
      if (intent.type !== "insert.open") return false;
      if (intent.kind !== "table" && intent.kind !== "embed") return false;
      const kind = intent.kind;
      preloadSurfaces();
      // Let the menu close and hand focus back first.
      requestAnimationFrame(() => {
        setStep(kind);
        setStepOpen(true);
      });
      return true;
    });
  }, [editor]);

  if (!editor) return null;

  return (
    <>
      {faceId ? (
        // M10 face, T1 only: the tier hides it from T2 on, where the plain
        // menu (with the kind pre-highlighted) remains.
        <span data-collapse-tier="t2" className="contents">
          <ActionButton
            id={faceId}
            editor={editor}
            showLabel
            label={`Insert ${editorActions.get(faceId)?.label.toLowerCase()}`}
          />
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <ToolbarButton
              ref={triggerRef}
              type="button"
              size="sm"
              className={cn(
                "st-insert-trigger",
                faceId && "st-insert-trigger--split",
              )}
              aria-label="Insert"
              tooltip="Insert"
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={preloadSurfaces}
              onFocus={preloadSurfaces}
            />
          }
        >
          <PlusIcon className="st-insert-plus" aria-hidden="true" />
          <span className="st-insert-label">Insert</span>
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <InsertMenuItems editor={editor} />
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover
        open={stepOpen}
        onOpenChange={setStepOpen}
        onOpenChangeComplete={(open) => {
          if (!open) setStep(null);
        }}
      >
        {/* No trigger: the step anchors to the Insert button itself, so no
            hidden focusable element joins the toolbar's roving set. */}
        <PopoverContent
          ref={stepPopupRef}
          anchor={triggerRef}
          aria-label={step ? STEP_LABEL[step] : undefined}
          align="start"
          className={step === "embed" ? "w-80" : undefined}
          finalFocus={stepFinalFocus}
        >
          {step ? (
            <InsertStep
              step={step}
              editor={editor}
              tableSize={tableSize.last}
              onDone={() => setStepOpen(false)}
            />
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  );
}
