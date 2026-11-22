"use client";

import type { Editor } from "@tiptap/react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { InsertStepKind } from "@/components/smart-toolbar/insert/insert-step";
import {
  lazySurface,
  loadInsertStep,
} from "@/components/smart-toolbar/lazy-surface";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { editorActions } from "@/lib/editor-actions";
import { availability, runAction } from "@/lib/editor-actions/registry";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";
import { computeContext } from "@/lib/editor-context/snapshot";
import { ArrowLeftIcon, ChevronRightIcon, PlusIcon } from "@/lib/icons";
import {
  INSERT_KIND_CHOICE,
  readChoice,
  TABLE_SIZE_CHOICE,
} from "@/lib/remembered-choice";
import { buildSlashItems, type SlashItem } from "@/lib/slash-menu/slash-items";

import { Section } from "./format-sheet";
import { insertSheetGroups, suggestedKinds } from "./insert-sheet-items";

/**
 * The table grid and the embed form, from the insert step chunk the row's
 * Insert menu uses (owner decision O1): never in the phone chunk itself.
 */
const InsertStep = lazySurface(
  () => loadInsertStep().then((module) => module.InsertStep),
  undefined,
  ({ step }) => (step === "table" ? "the table picker" : "the embed form"),
);

/** A step inside the sheet: the insert steps, or the diagram templates. */
type Step = InsertStepKind | "diagram";

/** Each step is titled by its kind's registry label. */
const STEP_ACTION: Record<Step, string> = {
  table: "insert.table",
  embed: "insert.embed",
  diagram: "insert.mermaid",
};

/** Kinds that open their step instead of running at once. */
const STEP_OF: Readonly<Record<string, InsertStepKind>> = {
  "insert.table": "table",
  "insert.embed": "embed",
};

/** The sheet's model, built once per open from the live document. */
function buildModel(editor: Editor) {
  const items = buildSlashItems(
    computeContext(editor),
    editorActions.list(),
    readChoice(TABLE_SIZE_CHOICE).last,
  );
  const emptyBlock = editor.state.selection.$from.parent.content.size === 0;
  return insertSheetGroups(items, {
    emptyBlock,
    kinds: suggestedKinds(readChoice(INSERT_KIND_CHOICE)),
  });
}

/**
 * One 44px cell: icon and label, start-aligned, with the table's size as a
 * note and, when it cannot run here, its reason on a second line (dp:207)
 * (also its description, `ToolbarButton`).
 */
function InsertCell({
  item,
  steps,
  suggested,
  onPick,
}: {
  item: SlashItem;
  /** Opens a step (▸), so the cell shows a chevron. */
  steps?: boolean;
  /** The Suggested copy of a kind that also has its own section's cell. */
  suggested?: boolean;
  onPick: (item: SlashItem) => void;
}) {
  const Icon = item.icon;
  return (
    <ToolbarButton
      type="button"
      size="sm"
      className="st-insert-cell"
      data-action-id={item.actionId}
      data-suggested={suggested ? "" : undefined}
      disabled={item.reason !== undefined}
      disabledReason={item.reason}
      onClick={() => onPick(item)}
    >
      {Icon ? (
        <Icon aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="size-4 shrink-0" />
      )}
      <span className="st-insert-cell-text">
        <span className="st-insert-cell-label">{item.label}</span>
        {item.reason ? (
          <span aria-hidden="true" className="st-insert-reason">
            {item.reason}
          </span>
        ) : null}
      </span>
      {item.note && !item.reason ? (
        <span className="st-insert-note">{item.note}</span>
      ) : null}
      {steps ? (
        <ChevronRightIcon
          aria-hidden="true"
          className="st-insert-chevron rtl:-scale-x-100"
        />
      ) : null}
    </ToolbarButton>
  );
}

/** The cells of one section, two columns of 44px. */
function CellGrid({
  items,
  suggested,
  onPick,
  children,
}: {
  items: readonly SlashItem[];
  suggested?: boolean;
  onPick: (item: SlashItem) => void;
  children?: ReactNode;
}) {
  return (
    <div className="st-sheet-list">
      {items.map((item) => (
        <InsertCell
          key={item.key}
          item={item}
          steps={item.actionId in STEP_OF}
          suggested={suggested}
          onPick={onPick}
        />
      ))}
      {children}
    </div>
  );
}

/** The "Diagram ▸" cell, standing for the menu's Diagrams section. */
function diagramCell(templates: readonly SlashItem[]): SlashItem | null {
  const action = editorActions.get("insert.mermaid");
  if (!templates.length || !action) return null;
  return {
    key: "diagram",
    actionId: "insert.mermaid",
    label: action.label,
    keywords: [],
    icon: action.icon,
    section: "Insert",
  };
}

function InsertSheetBody({
  editor,
  step,
  onStep,
  onDone,
}: {
  editor: Editor;
  step: Step | null;
  onStep: (step: Step | null) => void;
  /** Closes the sheet after a pick: focus goes back to the document. */
  onDone: () => void;
}) {
  // Once per open (the body unmounts when the sheet closes), and again
  // after a refusal, so the refused cell shows its reason.
  const [{ groups, diagrams }, setModel] = useState(() => buildModel(editor));
  const [refused, setRefused] = useState<string | null>(null);
  const diagram = diagramCell(diagrams);

  const pick = (item: SlashItem) => {
    const kind = STEP_OF[item.actionId];
    if (kind) return onStep(kind);
    if (item.key === "diagram") return onStep("diagram");
    const action = editorActions.get(item.actionId);
    if (!action) return;
    // The page is inert while the sheet is open, so the action's own
    // focus stays put; the close hands focus back to the editor.
    if (runAction(editor, action, item.arg)) return onDone();
    // Cells are what could run when the sheet opened: the document changed
    // since (a collaborator's edit). The sheet stays, says why on its own
    // status line (the bar's pill is under it) and redraws its cells.
    const enabled = availability(action, computeContext(editor));
    if (enabled === true) return onDone();
    setRefused(`${item.label}: ${enabled.reason}`);
    setModel(buildModel(editor));
  };

  if (step) {
    return (
      <div className="st-sheet-body" data-insert-step={step}>
        <div className="st-insert-step-head">
          <ToolbarButton
            type="button"
            size="sm"
            className="st-insert-back"
            onClick={() => onStep(null)}
          >
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            <span>Back</span>
          </ToolbarButton>
          <h3 className="st-sheet-heading">
            {editorActions.get(STEP_ACTION[step])?.label}
          </h3>
        </div>
        {step === "diagram" ? (
          <CellGrid items={diagrams} onPick={pick} />
        ) : (
          <InsertStep
            step={step}
            editor={editor}
            tableSize={readChoice(TABLE_SIZE_CHOICE).last}
            onDone={onDone}
          />
        )}
      </div>
    );
  }

  return (
    <div className="st-sheet-body">
      <p role="status" className="st-insert-refused">
        {refused}
      </p>
      {groups.map((group) => (
        <Section key={group.key} title={group.title}>
          <CellGrid
            items={group.items}
            suggested={group.key === "suggested"}
            onPick={pick}
          >
            {group.key === "insert" && diagram ? (
              <InsertCell item={diagram} steps onPick={pick} />
            ) : null}
          </CellGrid>
        </Section>
      ))}
    </div>
  );
}

export interface InsertSheetProps {
  editor: Editor;
  open: boolean;
  /** The bar makes the page inert while it is open, as for the Aa sheet. */
  onOpenChange: (open: boolean) => void;
  /** Render the bar's Insert cell (not while the selection cells show). */
  cell: boolean;
  /**
   * The on-screen keyboard's height (the bar's `useKeyboardInset`): the
   * embed step's link field raises it, and the sheet rides above it.
   */
  keyboardInset: number;
}

/**
 * The phone Insert sheet (spec §8.3, O6 a): the bar's Insert cell opens a
 * bottom sheet of the "/" menu's items as a two-column grid of 44px cells
 * (`insert-sheet-items.ts`). Picking closes it and hands focus back to the
 * editor, so the keyboard returns with the caret in the new block. Table
 * and embed open their step inside the sheet, from the lazy insert step
 * chunk; Diagram ▸ lists the templates. It also answers `insert.open`
 * (a "/" or palette pick of Table or Embed), opening at that step, which
 * the row's Insert menu does on desktop. Done, a swipe down and the scrim
 * close it. Part of the phone bar's lazy chunk (contract A9).
 */
export function InsertSheet({
  editor,
  open,
  onOpenChange,
  cell,
  keyboardInset,
}: InsertSheetProps) {
  const [step, setStep] = useState<Step | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** Set by a pick: focus goes to the editor, not back to the cell. */
  const pickedRef = useRef(false);

  useEffect(() => {
    let frame = 0;
    const off = onUiIntent(editor, (intent) => {
      if (intent.type !== "insert.open") return false;
      if (intent.kind !== "table" && intent.kind !== "embed") return false;
      if (!editor.isEditable) return false;
      const kind = intent.kind;
      // Let the "/" menu or the palette close first. Cancelled on unmount,
      // so it never makes the page inert after the bar has gone.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setStep(kind);
        pickedRef.current = false;
        onOpenChange(true);
      });
      return true;
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [editor, onOpenChange]);

  // The keyboard came up (or moved): keep the focused field in view in
  // the shortened sheet.
  useEffect(() => {
    if (!open || !keyboardInset) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.closest("[data-insert-sheet]")
    ) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [open, keyboardInset]);

  /**
   * After a pick: closes (which lifts the page's `inert`) and focuses the
   * editor at once, inside the tap, so a phone raises its keyboard again
   * (iOS only does so from a user gesture). `view.focus()` puts the DOM
   * caret where the pick left the selection; a bare `focus()` would read
   * the stale DOM selection back instead.
   */
  const onDone = useCallback(() => {
    pickedRef.current = true;
    onOpenChange(false);
    if (editor.isDestroyed) return;
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.scrollIntoView());
  }, [editor, onOpenChange]);

  /** Back to the Insert cell, unless a pick has focused the editor. */
  const finalFocus = useCallback(() => {
    if (!pickedRef.current) return triggerRef.current ?? true;
    pickedRef.current = false;
    return false;
  }, []);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) pickedRef.current = false;
        onOpenChange(next);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) setStep(null);
      }}
    >
      {cell ? (
        <SheetTrigger
          render={
            <ToolbarButton
              ref={triggerRef}
              type="button"
              data-surface="phone"
              aria-label="Insert"
              tooltip="Insert"
              aria-haspopup="dialog"
            />
          }
        >
          <PlusIcon aria-hidden="true" />
        </SheetTrigger>
      ) : null}
      <SheetContent
        data-insert-sheet=""
        data-toolbar-popup=""
        data-keyboard={keyboardInset ? "" : undefined}
        finalFocus={finalFocus}
        className="st-insert-sheet max-h-[75dvh]"
        style={
          keyboardInset
            ? ({ "--keyboard-inset": `${keyboardInset}px` } as CSSProperties)
            : undefined
        }
      >
        <SheetHeader>
          <SheetTitle className="flex-1">Insert</SheetTitle>
          <SheetClose
            render={<ToolbarButton type="button" className="st-sheet-done" />}
          >
            Done
          </SheetClose>
        </SheetHeader>
        <InsertSheetBody
          editor={editor}
          step={step}
          onStep={setStep}
          onDone={onDone}
        />
      </SheetContent>
    </Sheet>
  );
}
