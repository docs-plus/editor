"use client";

import type { Editor } from "@tiptap/react";
import { useRef } from "react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import {
  getV11Engine,
  repeatCopyAction,
  runWithEngine,
} from "@/lib/editor-actions/v11-actions";
import { PaintbrushIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

import { useEActionReason, usePainting } from "./use-e-action";

const TOOLTIP = (
  <span className="flex flex-col">
    Paint format
    <span className="text-background/70">
      Select text after clicking · Esc to cancel
    </span>
  </span>
);

/**
 * The Paint format brush (design pass §1, §2) in the selection bubble and
 * the phone selection bar. `aria-pressed` (the 12×2 bar) shows the armed
 * state, which lives in the engine, so it survives the brush unmounting.
 * A click arms; armed, it applies to a new selection or cancels. A tap
 * says so in its pill ("then tap 🖌 to apply"); touch never auto-applies.
 * Before the engine lands the click waits for it (`runWithEngine`); a
 * failed load says so on the pill, with Retry.
 */
export function PaintFormatButton({
  editor,
  phone = false,
}: {
  editor: Editor;
  /** The phone bar's 44×44 cell. */
  phone?: boolean;
}) {
  const painting = usePainting(editor);
  const reason = useEActionReason(repeatCopyAction, editor);
  // Armed, the brush always works: a second press cancels.
  const disabledReason = painting ? undefined : reason;
  const pointer = useRef("mouse");
  return (
    <ToolbarButton
      type="button"
      data-action-id={repeatCopyAction.id}
      data-surface={phone ? "phone" : "bubble"}
      aria-label={repeatCopyAction.label}
      tooltip={TOOLTIP}
      isActive={painting}
      disabled={disabledReason !== undefined}
      disabledReason={disabledReason}
      className={cn(phone && "min-h-11 min-w-11")}
      onPointerDown={(event) => {
        pointer.current = event.pointerType;
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const touch = pointer.current === "touch";
        pointer.current = "mouse";
        runWithEngine(editor, () =>
          getV11Engine()?.paint.toggle(editor, touch),
        );
      }}
    >
      <PaintbrushIcon className="tiptap-button-icon" aria-hidden="true" />
    </ToolbarButton>
  );
}
