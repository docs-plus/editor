"use client";

import { type Editor, useCurrentEditor } from "@tiptap/react";
import { type ReactNode, useRef, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { colorLabel } from "@/lib/editor-actions/surface-actions";
import { BaselineIcon, ChevronDownIcon, HighlighterIcon } from "@/lib/icons";
import {
  HIGHLIGHT_CHOICE,
  RECENT_COLORS_CHOICE,
  TEXT_COLOR_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";

import { type Swatch, swatchStyle } from "./color/swatch";
import { lazySurface, loadColorPanel, preloadSurfaces } from "./lazy-surface";
import type { SurfaceProps } from "./types";
import "./smart-toolbar.scss";

/** Popover body: its own chunk, fetched on first hover, focus or open. */
const ColorPanel = lazySurface(
  () => loadColorPanel().then((module) => module.ColorPanel),
  <div className="st-color-panel-fallback" />,
);

type ColorKind = "text" | "highlight";
/** Where the colour popover opens; the bubble opens it away from the text. */
type PopoverSide = "top" | "bottom";

const faceSwatch = (kind: ColorKind, token: Swatch["token"]): Swatch =>
  kind === "text" ? { kind, token } : { kind, token };

const COPY = {
  text: {
    actionId: "color.text.apply",
    apply: "Apply text colour",
    more: "More text colours",
    Icon: BaselineIcon,
  },
  highlight: {
    actionId: "color.highlight.apply",
    apply: "Apply highlight",
    more: "More highlight colours",
    Icon: HighlighterIcon,
  },
} as const;

interface ColorPopoverButtonProps {
  editor: Editor;
  /** The swatch row that takes focus when the popover opens. */
  focusKind: ColorKind;
  label: string;
  className?: string;
  reason?: string;
  side?: PopoverSide;
  children: ReactNode;
}

/**
 * A trigger that opens the one colour popover (spec §4.5): the split
 * chevrons and the T4 stand-in that replaces the pair (spec §4.6).
 */
export function ColorPopoverButton({
  editor,
  focusKind,
  label,
  className,
  reason,
  side,
  children,
}: ColorPopoverButtonProps) {
  const recent = useRememberedChoice(RECENT_COLORS_CHOICE);
  const [open, setOpen] = useState(false);
  // A tap keeps the editor focused, so the phone keyboard (and the toolbar
  // docked on it) stays put; keyboard and mouse opens focus a swatch.
  const [openedByTouch, setOpenedByTouch] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={reason !== undefined}
        render={
          <ToolbarButton
            type="button"
            className={className}
            aria-label={label}
            tooltip={label}
            aria-haspopup="dialog"
            disabled={reason !== undefined}
            disabledReason={reason}
            onPointerEnter={preloadSurfaces}
            onFocus={preloadSurfaces}
            onPointerDown={(event) =>
              setOpenedByTouch(event.pointerType === "touch")
            }
            onKeyDown={() => setOpenedByTouch(false)}
            onMouseDown={(event) => event.preventDefault()}
          />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        ref={popupRef}
        aria-label={focusKind === "text" ? "Text colours" : "Highlight colours"}
        className="st-color-popover"
        side={side}
        initialFocus={(openType) =>
          openType === "touch" || openedByTouch
            ? false
            : (popupRef.current?.querySelector<HTMLElement>(
                'button[tabindex="0"]',
              ) ?? true)
        }
      >
        <ColorPanel
          editor={editor}
          recent={recent.recent}
          focusKind={focusKind}
          focusOnMount={!openedByTouch}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * One split control (spec §4.5, M1/M2): the face reapplies the remembered
 * colour ("Apply text colour: Red"); the chevron opens the colour popover.
 */
export function ColorSplit({
  kind,
  editor: providedEditor,
  popoverSide,
}: SurfaceProps & { kind: ColorKind; popoverSide?: PopoverSide }) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = providedEditor ?? contextEditor ?? null;
  const copy = COPY[kind];
  const view = useActionView(copy.actionId, editor);
  const remembered = useRememberedChoice(
    kind === "text" ? TEXT_COLOR_CHOICE : HIGHLIGHT_CHOICE,
  );

  if (!editor || !view) return null;
  const reason = view.enabled === true ? undefined : view.enabled.reason;
  const faceLabel = `${copy.apply}: ${colorLabel(remembered.last)}`;
  const { Icon } = copy;

  return (
    <div className="st-split" data-color-kind={kind}>
      <ToolbarButton
        type="button"
        className="st-split-face"
        aria-label={faceLabel}
        tooltip={faceLabel}
        disabled={reason !== undefined}
        disabledReason={reason}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const action = editorActions.get(copy.actionId);
          if (action) runAction(editor, action, remembered.last);
        }}
      >
        <Icon aria-hidden="true" />
        <span
          aria-hidden="true"
          className={`st-face-bar st-face-bar--${kind}`}
          style={swatchStyle(faceSwatch(kind, remembered.last))}
        />
      </ToolbarButton>
      <ColorPopoverButton
        editor={editor}
        focusKind={kind}
        label={copy.more}
        className="st-split-chevron"
        reason={reason}
        side={popoverSide}
      >
        <ChevronDownIcon aria-hidden="true" />
      </ColorPopoverButton>
    </div>
  );
}

/**
 * Row colour pair: text **A** split + highlight ✎ split, one popover body
 * (spec §4.5, M1–M3). PR D2 owns.
 */
export function ColorControls({ editor }: SurfaceProps) {
  return (
    <div className="st-color-controls" role="group" aria-label="Colours">
      <ColorSplit kind="text" editor={editor} />
      <ColorSplit kind="highlight" editor={editor} />
    </div>
  );
}
