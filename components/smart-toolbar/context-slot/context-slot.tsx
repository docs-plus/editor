"use client";

import type { Editor } from "@tiptap/react";
import { lazy, Suspense, useRef } from "react";

import { useIdlePreload } from "@/components/smart-toolbar/idle-preload";
import { useSurfaceEditor } from "@/components/smart-toolbar/row/action-menu";
import type { ContextKind } from "@/lib/editor-actions/types";

import { useSlotTarget, useToolbarHold } from "./use-slot-target";

/** The slot's controls: their own chunk, fetched when the page is idle. */
export const loadSlotContents = () => import("./slot-contents");
const SlotContents = lazy(() =>
  loadSlotContents().then((module) => ({ default: module.SlotContents })),
);

/** Fixed width so the row never shifts as the context changes (spec §4.2). */
const SLOT_WIDTH = 168;

export const SLOT_LABELS: Partial<Record<ContextKind, string>> = {
  heading: "Section tools",
  title: "Title",
  code: "Code block tools",
  mermaid: "Diagram tools",
  table: "Table tools",
  media: "Media tools",
};

/**
 * The context slot (spec §4.2): a fixed-width group before Insert whose
 * contents follow the selection's kind, immediately on selection changes.
 * `role="group"` with a changing `aria-label` and no live region; empty for
 * paragraphs and lists, and then hidden from assistive tech. Contents are
 * frozen while focus is in the toolbar (`hold()`); enabled states keep
 * updating, and every run rechecks the live document. The slot never
 * clips (no `overflow-hidden`): each control's 2px focus outline sits 2px
 * outside it (WCAG 2.4.7, 2.4.11); a long language value shrinks instead.
 */
export function ContextSlot({ editor: provided }: { editor?: Editor | null }) {
  const editor = useSurfaceEditor(provided);
  const ref = useRef<HTMLDivElement>(null);
  const { kind, headingId } = useSlotTarget(editor);
  useToolbarHold(editor, ref);
  useIdlePreload(loadSlotContents);
  const label = SLOT_LABELS[kind];
  const style = { width: SLOT_WIDTH, minWidth: SLOT_WIDTH };
  if (!editor || !label) {
    return (
      <div
        ref={ref}
        data-slot="context-slot"
        data-kind={kind}
        aria-hidden="true"
        style={style}
      />
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toolbar group, not a fieldset
    <div
      ref={ref}
      role="group"
      aria-label={label}
      data-slot="context-slot"
      data-kind={kind}
      className="flex items-center gap-0.5 py-1"
      style={style}
    >
      <Suspense fallback={null}>
        <SlotContents kind={kind} headingId={headingId} editor={editor} />
      </Suspense>
    </div>
  );
}
