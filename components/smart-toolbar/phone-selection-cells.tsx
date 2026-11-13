"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useRememberedBundle } from "@/extensions/repeat-formatting/bundle-memory";
import { announce } from "@/lib/announce";
import { runAction } from "@/lib/editor-actions/registry";
import { colorLabel } from "@/lib/editor-actions/surface-actions";
import { repeatApplyAction } from "@/lib/editor-actions/v11-actions";
import { CloseIcon, CopyIcon, RepeatIcon } from "@/lib/icons";
import {
  HIGHLIGHT_CHOICE,
  TEXT_COLOR_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";

import { ActionButton } from "./action-button";
import {
  FormatsMenu,
  repeatName,
  repeatShortcut,
  useEAction,
} from "./repeat-split-button";
import type { SurfaceProps } from "./types";

export type MobileBarMode = "all" | "selection";

/**
 * Whether the phone bar shows its normal cells or the selection cells
 * (spec §4.7). ✕ for this selection (`dismissedForSelection`) always means
 * "all": it is the user's own action, so it overrides the focus guard.
 * Otherwise it never swaps while focus is inside the bar (VoiceOver would
 * lose its place), and swaps to "selection" iff text is selected. D2's
 * phone bar calls it and resets `dismissedForSelection` on a new selection.
 */
export function nextMobileBarMode(input: {
  hasTextSelection: boolean;
  focusInBar: boolean;
  dismissedForSelection: boolean;
  current: MobileBarMode;
}): MobileBarMode {
  if (input.dismissedForSelection) return "all";
  if (input.focusInBar) return input.current;
  return input.hasTextSelection ? "selection" : "all";
}

/** How long a tapped cell's unavailable reason stays on screen. */
const REASON_MS = 4000;

/**
 * ↻ Repeat as a phone cell, named for what it repeats ("Repeat Bold").
 * Its availability is read live (`useEAction`: the remembered bundle is
 * outside the snapshot). Unavailable, it stays tappable and
 * `aria-disabled`: a tap shows the reason above the bar and announces it,
 * since a touch screen has no hover tooltip to explain the dimmed cell.
 */
function RepeatCell({ editor }: { editor: Editor }) {
  const bundle = useRememberedBundle();
  const enabled = useEAction(repeatApplyAction, editor);
  const reason = enabled === true ? undefined : enabled.reason;
  const shortcut = useMemo(() => repeatShortcut(), []);
  const reasonId = useId();
  // The reason stays live while shown ("still loading" turns into the
  // real reason when the engine lands).
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (reason === undefined) setShown(false);
  }, [reason]);
  const showReason = (text: string) => {
    setShown(true);
    announce(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), REASON_MS);
  };
  return (
    <>
      <ToolbarButton
        type="button"
        data-action-id={repeatApplyAction.id}
        data-surface="phone"
        aria-label={repeatName(bundle)}
        aria-keyshortcuts={shortcut.aria}
        aria-disabled={reason === undefined ? undefined : true}
        aria-describedby={reason === undefined ? undefined : reasonId}
        tooltip={reason ?? repeatApplyAction.label}
        className="min-h-11 min-w-11 aria-disabled:opacity-50"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (reason === undefined) runAction(editor, repeatApplyAction);
          else showReason(reason);
        }}
      >
        <RepeatIcon className="tiptap-button-icon" aria-hidden="true" />
      </ToolbarButton>
      {reason === undefined ? null : (
        <span id={reasonId} hidden>
          {reason}
        </span>
      )}
      {shown && reason !== undefined ? (
        <span
          className="pointer-events-none absolute inset-x-2 bottom-[calc(100%+6px)] rounded-md bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-md"
          data-phone-reason=""
          aria-hidden
        >
          {reason}
        </span>
      ) : null}
    </>
  );
}

/**
 * The Formats menu as a phone cell: Copy formatting, Save as format…,
 * Your formats and In this doc (the Repeat reason points at Copy
 * formatting, so the phone needs a way to it). Opens above the bar.
 */
function FormatsCell({ editor }: { editor: Editor }) {
  return (
    <FormatsMenu
      editor={editor}
      side="top"
      trigger={
        <ToolbarButton
          type="button"
          data-surface="phone"
          aria-label="Formats"
          aria-haspopup="menu"
          tooltip="Formats"
          className="min-h-11 min-w-11"
          onMouseDown={(event) => event.preventDefault()}
        />
      }
    >
      <CopyIcon className="tiptap-button-icon" aria-hidden="true" />
    </FormatsMenu>
  );
}

/**
 * Text colour and highlight apply the colour last used (M3), like the
 * row's split face; the Aa sheet keeps the full palette.
 */
function ColorCells({ editor }: { editor: Editor }) {
  const text = useRememberedChoice(TEXT_COLOR_CHOICE).last;
  const highlight = useRememberedChoice(HIGHLIGHT_CHOICE).last;
  return (
    <>
      <ActionButton
        id="color.text.apply"
        editor={editor}
        variant="phone"
        arg={text}
        label={`Apply text colour: ${colorLabel(text)}`}
      />
      <ActionButton
        id="color.highlight.apply"
        editor={editor}
        variant="phone"
        arg={highlight}
        label={`Apply highlight: ${colorLabel(highlight)}`}
      />
    </>
  );
}

/**
 * After ✕ the cells unmount under focus. Once the bar re-renders its
 * normal cells, focus its first enabled one, so focus never drops to
 * `<body>` (spec §6.6). Does nothing if focus already moved elsewhere.
 */
function focusBarAfterBack(bar: Element | null): void {
  if (!bar) return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const target =
      bar.querySelector<HTMLElement>(
        "button:not([disabled]):not([aria-disabled='true'])",
      ) ?? bar.querySelector<HTMLElement>("button");
    target?.focus();
  });
}

/** The bar's label while swapped; the bar stays one `role="toolbar"`. */
export const SELECTION_BAR_LABEL = "Selection formatting";

/**
 * Registry ids, in order (`formats`: the Formats menu cell); unknown ids
 * render nothing until their track lands.
 */
export const PHONE_SELECTION_CELL_IDS = [
  "mark.bold",
  "mark.italic",
  "mark.underline",
  "mark.strike",
  "color.text.apply",
  "color.highlight.apply",
  "mark.link",
  "format.clear",
  "repeat.apply",
  "formats",
] as const;

const COLOR_CELL_IDS = new Set<string>([
  "color.text.apply",
  "color.highlight.apply",
]);

/** Width of the edge fades that show the cells scroll. */
const FADE = "24px";

/**
 * Fades the ends of the cell scroller that hide cells, so it is clear the
 * bar scrolls, and marks them (`data-more`: "start", "end", "both"). Set
 * here, not in the stylesheet, which is in the editor chunk. Also keeps a
 * focused cell in view (roving focus does not scroll).
 */
function useScrollEdges() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = Math.abs(el.scrollLeft) > 1;
      const end = el.scrollWidth - el.clientWidth - Math.abs(el.scrollLeft) > 1;
      const more = start && end ? "both" : start ? "start" : end ? "end" : "";
      if (more) el.dataset.more = more;
      else delete el.dataset.more;
      el.style.maskImage = more
        ? `linear-gradient(to right, ${start ? "transparent" : "#000"}, #000 ${FADE}, #000 calc(100% - ${FADE}), ${end ? "transparent" : "#000"})`
        : "";
    };
    // Roving focus does not scroll: keep the focused cell in view.
    const reveal = (event: FocusEvent) => {
      if (event.target instanceof Element) {
        event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("focusin", reveal);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("focusin", reveal);
      observer.disconnect();
    };
  }, []);
  return ref;
}

/**
 * Mobile selection swap (spec §4.7): B I U S, text colour, highlight,
 * link, clear, ↻ Repeat, Formats, then ✕ "Back to all tools". Rendered by
 * D2's phone bar in place of its own cells, inside its one toolbar. The
 * cells scroll sideways in their own container with edge fades; ✕ sits
 * beside it, outside the scroller, so no cell (at rest or focused) is ever
 * under it (WCAG 2.4.11). Cells are registry actions through
 * `ActionButton` (44×44 in the phone variant). ✕ calls `onBack` (D2 sets
 * `dismissedForSelection`), then moves focus to the bar's first cell once
 * the normal cells are back.
 */
export function PhoneSelectionCells({
  editor: provided,
  onBack,
}: SurfaceProps & {
  onBack: () => void;
}) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = provided ?? contextEditor ?? null;
  const scroller = useScrollEdges();
  if (!editor) return null;
  return (
    <>
      <div
        className="flex min-w-0 flex-auto overflow-x-auto overscroll-x-contain [scrollbar-width:none] *:flex-[1_0_44px]"
        data-phone-selection-cells=""
        ref={scroller}
      >
        {PHONE_SELECTION_CELL_IDS.map((id) =>
          id === repeatApplyAction.id ? (
            <RepeatCell key={id} editor={editor} />
          ) : id === "formats" ? (
            <FormatsCell key={id} editor={editor} />
          ) : id === "color.text.apply" ? (
            <ColorCells key={id} editor={editor} />
          ) : COLOR_CELL_IDS.has(id) ? null : (
            <ActionButton key={id} id={id} editor={editor} variant="phone" />
          ),
        )}
      </div>
      <ToolbarButton
        type="button"
        aria-label="Back to all tools"
        tooltip="Back to all tools"
        className="min-h-11 min-w-11 shrink-0"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const bar = event.currentTarget.closest('[role="toolbar"]');
          onBack();
          focusBarAfterBack(bar);
        }}
      >
        <CloseIcon className="tiptap-button-icon" aria-hidden="true" />
      </ToolbarButton>
    </>
  );
}
