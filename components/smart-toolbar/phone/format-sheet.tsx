"use client";

import type { Editor } from "@tiptap/react";
import { type ReactNode, useId } from "react";

import { ThemeToggle } from "@/components/document-editor/theme-toggle";
import { ActionButton } from "@/components/smart-toolbar/action-button";
import { ColorPanel } from "@/components/smart-toolbar/color/color-panel";
import { useSlotTarget } from "@/components/smart-toolbar/context-slot/use-slot-target";
import { FontSizeStepper } from "@/components/smart-toolbar/font-size-stepper";
import { SheetFormats } from "@/components/smart-toolbar/formats/sheet-formats";
import { useActionView } from "@/hooks/use-editor-context";
import { CODE_LANGUAGES } from "@/lib/code-language";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import type { ContextKind } from "@/lib/editor-actions/types";
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

/**
 * The slot cell's tools by context, named like the cell (the row's T3
 * stand-in). Kept here: importing them from the row's slot modules would
 * split those into a shared chunk of the editor group (contract A9).
 */
const SLOT_TOOLS: Partial<
  Record<ContextKind, { label: string; ids: readonly string[] }>
> = {
  heading: {
    label: "Section tools",
    ids: ["section.fold", "section.moveUp", "section.moveDown"],
  },
  code: { label: "Code block tools", ids: ["code.copy"] },
  mermaid: { label: "Diagram tools", ids: ["mermaid.copySource"] },
  table: {
    label: "Table tools",
    ids: [
      "table.addRowBefore",
      "table.addRowAfter",
      "table.deleteRow",
      "table.addColumnBefore",
      "table.addColumnAfter",
      "table.deleteColumn",
      "table.toggleHeaderRow",
      "table.mergeOrSplit",
    ],
  },
  media: { label: "Media tools", ids: ["media.options"] },
};

const LANGUAGE_ACTION: Partial<
  Record<ContextKind, "code.language" | "mermaid.language">
> = { code: "code.language", mermaid: "mermaid.language" };

function Section({
  title,
  children,
  className = "st-sheet-section",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={className} aria-labelledby={id}>
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
 * The language picker as a native select: the phone's own list picker,
 * one 44px control, named by its label. A pick runs the registry action.
 */
function LanguageSelect({
  id,
  editor,
}: {
  id: "code.language" | "mermaid.language";
  editor: Editor;
}) {
  const view = useActionView(id, editor);
  const action = editorActions.get(id);
  if (!view || !action) return null;
  const current = CODE_LANGUAGES.find((option) => option.label === view.value);
  return (
    <label className="st-sheet-select">
      <span>
        {id === "code.language" ? "Code language" : "Diagram language"}
      </span>
      <select
        value={current?.value ?? "plaintext"}
        disabled={view.enabled !== true}
        onChange={(event) => runAction(editor, action, event.target.value)}
      >
        {CODE_LANGUAGES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Below 360px the bar has no room for the context slot cell, so the sheet
 * carries its tools (shown by `phone.scss` only there), named like the
 * cell ("Section tools", "Table tools"…). Media options opens the kit's
 * toolbar over the page, so it closes the sheet first, like Link.
 */
function SlotSection({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const { kind, headingId } = useSlotTarget(editor);
  const tools = SLOT_TOOLS[kind];
  const language = LANGUAGE_ACTION[kind];
  if (!tools) return null;
  return (
    <Section title={tools.label} className="st-sheet-section st-sheet-slot">
      {language ? <LanguageSelect id={language} editor={editor} /> : null}
      <div
        className="st-sheet-list"
        onClickCapture={kind === "media" ? onClose : undefined}
      >
        {tools.ids.map((id) => (
          <ActionButton
            key={id}
            id={id}
            editor={editor}
            variant="phone"
            showLabel
            arg={kind === "heading" ? headingId : undefined}
          />
        ))}
      </div>
    </Section>
  );
}

/**
 * Body of the phone "Text format" sheet (spec §4.7, design pass §6):
 * Colours first, so the swatches show without scrolling, then the slot's
 * tools (below 360px), Style, Your formats, Size, Align and More (Redo
 * below 404px, Outdent, underline, strikethrough, clear formatting,
 * Link). Every control is a registry action (`ActionButton`,
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
      {/* A pick keeps the sheet open: writers try colours (O4). */}
      <Section title="Colours">
        <ColorPanel
          editor={editor}
          recent={recent}
          focusKind="text"
          focusOnMount={false}
        />
      </Section>
      <SlotSection editor={editor} onClose={onClose} />
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
      <Section title="Your formats">
        <SheetFormats editor={editor} onClose={onClose} />
      </Section>
      <Section title="Size">
        <FontSizeStepper editor={editor} />
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
