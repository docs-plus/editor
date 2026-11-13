"use client";

import { useCurrentEditor } from "@tiptap/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { editorActions } from "@/lib/editor-actions";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";
import { ChevronDownIcon, PlusIcon } from "@/lib/icons";
import {
  INSERT_KIND_CHOICE,
  type InsertKind,
  TABLE_SIZE_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";
import { cn } from "@/lib/utils";

import { useIdlePreload } from "./idle-preload";
import type { InsertStepKind as Step } from "./insert/insert-menu-body";
import type { SurfaceProps } from "./types";
import "./smart-toolbar.scss";

/** Menu items and steps: their own chunk, fetched when the page is idle. */
const loadInsertBody = () => import("./insert/insert-menu-body");
const InsertMenuItems = lazy(() =>
  loadInsertBody().then((module) => ({ default: module.InsertMenuItems })),
);
const InsertStep = lazy(() =>
  loadInsertBody().then((module) => ({ default: module.InsertStep })),
);

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
  const [step, setStep] = useState<Step | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useIdlePreload(loadInsertBody);

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
      {faceId ? (
        // M10 face, T1 only: the tier hides it from T2 on, where the plain
        // menu (with the kind pre-highlighted) remains.
        <span data-collapse-tier="t2" className="contents">
          <ActionButton id={faceId} editor={editor} showLabel />
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
              onPointerEnter={loadInsertBody}
              onFocus={loadInsertBody}
            />
          }
        >
          <PlusIcon className="st-insert-plus" aria-hidden="true" />
          <span className="st-insert-label">Insert</span>
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <Suspense fallback={null}>
            <InsertMenuItems editor={editor} />
          </Suspense>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover
        open={step !== null}
        onOpenChange={(open) => {
          if (!open) setStep(null);
        }}
      >
        {/* No trigger: the step anchors to the Insert button itself, so no
            hidden focusable element joins the toolbar's roving set. */}
        <PopoverContent
          anchor={triggerRef}
          aria-label={step ? STEP_LABEL[step] : undefined}
          align="start"
          className={step === "embed" ? "w-80" : undefined}
          finalFocus={triggerRef}
        >
          {step ? (
            <Suspense fallback={null}>
              <InsertStep
                step={step}
                editor={editor}
                tableSize={tableSize.last}
                onDone={() => setStep(null)}
              />
            </Suspense>
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  );
}
