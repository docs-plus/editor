"use client";

import { useCurrentEditor } from "@tiptap/react";
import { type KeyboardEvent, useId } from "react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import {
  FONT_SIZE_LABELS,
  FONT_SIZE_SHORT,
} from "@/lib/editor-actions/surface-actions";
import {
  FONT_SIZE_EM,
  FONT_SIZE_LADDER,
  type FontSizeStep,
} from "@/lib/text-style-tokens";

import type { SurfaceProps } from "./types";
import "./smart-toolbar.scss";

/** Body text size in px (`paragraph-node.scss`), for "about N pixels". */
const BODY_FONT_PX = 15;

const isStep = (value: string | null): value is FontSizeStep =>
  value !== null && (FONT_SIZE_LADDER as readonly string[]).includes(value);

export function sizeValueText(step: FontSizeStep, mixed: boolean): string {
  if (mixed) return "Mixed sizes";
  const px = Math.round(BODY_FONT_PX * FONT_SIZE_EM[step]);
  return `${FONT_SIZE_LABELS[step]}, about ${px} pixels`;
}

/**
 * Row size stepper `− M +` (spec §4.1). The value is a `spinbutton` with
 * `aria-valuetext` ("Large, about 19 pixels"); ↑/↓, Home and End step it,
 * and the − / + buttons are the registry's `size.*` actions. Disabled with
 * a reason in headings ("Headings scale automatically.").
 */
export function FontSizeStepper({ editor: providedEditor }: SurfaceProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = providedEditor ?? contextEditor ?? null;
  const view = useActionView("size.set", editor);
  const reasonId = useId();
  if (!editor || !view) return null;

  const step = isStep(view.value) ? view.value : "md";
  const index = FONT_SIZE_LADDER.indexOf(step);
  const reason = view.enabled === true ? undefined : view.enabled.reason;

  const setStep = (next: FontSizeStep | undefined) => {
    const action = editorActions.get("size.set");
    if (next && action && next !== step) runAction(editor, action, next);
  };

  /**
   * Runs in the capture phase and stops propagation, so the toolbar's
   * roving handler (a native capture listener on the toolbar, below React's
   * root) never sees these keys: Home/End would also move focus to the
   * first/last tool, and Enter would click a stale roving item. ←/→ still
   * rove.
   */
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.stopPropagation();
      return;
    }
    const keys: Record<string, FontSizeStep | undefined> = {
      ArrowUp: FONT_SIZE_LADDER[index + 1],
      ArrowDown: FONT_SIZE_LADDER[index - 1],
      PageUp: FONT_SIZE_LADDER[index + 1],
      PageDown: FONT_SIZE_LADDER[index - 1],
      Home: FONT_SIZE_LADDER[0],
      End: FONT_SIZE_LADDER[FONT_SIZE_LADDER.length - 1],
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!reason) setStep(keys[event.key]);
  };

  return (
    <div className="st-stepper" role="group" aria-label="Font size">
      <ActionButton id="size.decrease" editor={editor} />
      <div
        role="spinbutton"
        tabIndex={0}
        className="st-stepper-value"
        aria-label="Font size"
        aria-valuemin={0}
        aria-valuemax={FONT_SIZE_LADDER.length - 1}
        aria-valuenow={index}
        aria-valuetext={sizeValueText(step, view.mixed)}
        aria-disabled={reason ? true : undefined}
        aria-describedby={reason ? reasonId : undefined}
        title={reason ?? sizeValueText(step, view.mixed)}
        onKeyDownCapture={onKeyDownCapture}
      >
        {view.mixed ? "–" : FONT_SIZE_SHORT[step]}
      </div>
      {reason ? (
        <span id={reasonId} hidden>
          {reason}
        </span>
      ) : null}
      <ActionButton id="size.increase" editor={editor} />
    </div>
  );
}
