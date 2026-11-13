"use client";

import type { Editor } from "@tiptap/react";
import { type ReactNode, useId } from "react";

import { ThemeToggle } from "@/components/document-editor/theme-toggle";
import { ActionButton } from "@/components/smart-toolbar/action-button";
import { ColorPanel } from "@/components/smart-toolbar/color/color-panel";
import { FontSizeStepper } from "@/components/smart-toolbar/font-size-stepper";
import type { RecentColor } from "@/lib/remembered-choice";

/** Style rows (the title's own reason, "Title is always H1.", locks them). */
const STYLE_IDS = [
  "style.paragraph",
  "style.heading1",
  "style.heading2",
  "style.heading3",
  "style.heading4",
  "style.heading5",
  "style.heading6",
] as const;
const ALIGN_IDS = [
  "align.left",
  "align.center",
  "align.right",
  "align.justify",
];
/**
 * The ⋯ items (spec §4.7), plus underline and strikethrough, which the old
 * phone row had and the bar has no cell for. Ids not registered yet render
 * nothing (`ActionButton`).
 */
const MORE_IDS = [
  "history.redo",
  "indent.outdent",
  "mark.underline",
  "mark.strike",
  "mark.superscript",
  "mark.subscript",
  "mark.inlineCode",
  "format.clear",
  "memory.forget",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="st-sheet-section" aria-labelledby={id}>
      <h3 id={id} className="st-sheet-heading">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Link opens the Hyperlink extension's own popover over the document, so
 * the sheet closes first: the editor is `inert` while it is open, and the
 * popover would open behind it. The capture handler runs before the
 * button's own click, which then acts on the live editor; that close
 * leaves focus in the popover instead of returning it to Aa.
 */
function LinkRow({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  return (
    <div className="contents" onClickCapture={onClose}>
      <ActionButton id="mark.link" editor={editor} variant="phone" showLabel />
    </div>
  );
}

/**
 * Body of the phone "Text format" sheet (spec §4.7): Style, Size, Colours,
 * Align and More (Redo below 360px, Outdent, Link). Every control is a registry action (`ActionButton`,
 * `FontSizeStepper` over `size.*`, `ColorPanel` over `color.*`), so the
 * reasons (title, headings, code, read-only) and `aria-pressed` states are
 * the row's. Part of the phone bar's lazy chunk (contract A9).
 */
export function FormatSheetBody({
  editor,
  recent,
  onClose,
}: {
  editor: Editor;
  /** Closes the sheet (before an action that opens a popover over the page). */
  onClose: () => void;
  /** M3, read by the bar (ready before the sheet opens); frozen while open. */
  recent: readonly RecentColor[];
}) {
  return (
    <div className="st-sheet-body">
      <Section title="Style">
        <div className="st-sheet-list">
          {STYLE_IDS.map((id) => (
            <ActionButton
              key={id}
              id={id}
              editor={editor}
              variant="phone"
              showLabel
            />
          ))}
        </div>
      </Section>
      <Section title="Size">
        <FontSizeStepper editor={editor} />
      </Section>
      {/* A pick keeps the sheet open: writers try colours (O4). */}
      <Section title="Colours">
        <ColorPanel
          editor={editor}
          recent={recent}
          focusKind="text"
          focusOnMount={false}
        />
      </Section>
      <Section title="Align">
        <div className="st-sheet-grid">
          {ALIGN_IDS.map((id) => (
            <ActionButton key={id} id={id} editor={editor} variant="phone" />
          ))}
        </div>
      </Section>
      <Section title="More">
        <div className="st-sheet-list">
          {MORE_IDS.map((id) => (
            <ActionButton
              key={id}
              id={id}
              editor={editor}
              variant="phone"
              showLabel
            />
          ))}
          <LinkRow editor={editor} onClose={onClose} />
          <ThemeToggle />
        </div>
      </Section>
    </div>
  );
}
