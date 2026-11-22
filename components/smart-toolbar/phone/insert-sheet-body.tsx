"use client";

import type { Editor } from "@tiptap/react";
import {
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { InsertStepKind } from "@/components/smart-toolbar/insert/insert-step";
import {
  lazySurface,
  loadInsertStep,
} from "@/components/smart-toolbar/lazy-surface";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { editorActions } from "@/lib/editor-actions";
import { availability, runAction } from "@/lib/editor-actions/registry";
import { computeContext } from "@/lib/editor-context/snapshot";
import { ArrowLeftIcon, ChevronRightIcon } from "@/lib/icons";
import { readChoice, TABLE_SIZE_CHOICE } from "@/lib/remembered-choice";
import type { SlashItem } from "@/lib/slash-menu/slash-items";

import {
  buildSlashItems,
  HAS_NEW_BADGES,
  isNewItem,
  localDay,
  recentInsertKinds,
} from "../slash/slash-menu";
import { DIAGRAM_CELL, insertSheetGroups } from "./insert-sheet-items";

/*
 * The Insert sheet's body (spec §8.3): its own lazy chunk, loaded by the
 * phone bar's `insert-sheet.tsx` when the browser is idle and on the
 * Insert cell's press, so the sheet never shows a loading state.
 */

/**
 * The table grid and the embed form, from the insert step chunk the row's
 * Insert menu uses (owner decision O1).
 */
const InsertStep = lazySurface(
  () => loadInsertStep().then((module) => module.InsertStep),
  undefined,
  ({ step }) => (step === "table" ? "the table picker" : "the embed form"),
);

/** A step inside the sheet: the insert steps, or the diagram templates. */
export type InsertSheetStep = InsertStepKind | "diagram";

/** Each step is titled by its kind's registry label. */
const STEP_ACTION: Record<InsertSheetStep, string> = {
  table: "insert.table",
  embed: "insert.embed",
  diagram: "insert.mermaid",
};

/** Kinds that open their step instead of running at once. */
const STEP_OF: Readonly<Record<string, InsertStepKind>> = {
  "insert.table": "table",
  "insert.embed": "embed",
};

/** The "Diagram ▸" cell: `insert.mermaid`'s label and icon. */
function diagramItem(): SlashItem | null {
  const action = editorActions.get("insert.mermaid");
  return action
    ? {
        key: action.id,
        actionId: action.id,
        label: action.label,
        keywords: [],
        icon: action.icon,
        section: "Insert",
      }
    : null;
}

/**
 * The sheet's model, built once per open from the live document: the "/"
 * menu's items with its Suggested rows (the recent kinds, A19), and the
 * keys that show "New" as they do there (none while none are declared).
 */
function buildModel(editor: Editor) {
  const actions = editorActions.list();
  const recent = recentInsertKinds();
  const items = buildSlashItems(
    computeContext(editor),
    actions,
    readChoice(TABLE_SIZE_CHOICE).last,
    recent,
  );
  return {
    ...insertSheetGroups(items, {
      emptyBlock: editor.state.selection.$from.parent.content.size === 0,
      insertOrder: actions.map((action) => action.id),
      diagram: diagramItem(),
    }),
    fresh: new Set(
      HAS_NEW_BADGES
        ? items
            .filter((item) => isNewItem(item, localDay(), recent))
            .map((item) => item.key)
        : [],
    ),
  };
}

/** Whether the cell opens a step (▸) instead of running. */
const opensStep = (item: SlashItem) =>
  item.actionId in STEP_OF || item.key === DIAGRAM_CELL;

/**
 * One 44px cell: icon and label, start-aligned, with the table's size as a
 * note and, when it cannot run here, its reason on a second line (dp:207)
 * (also its description, `ToolbarButton`).
 */
function InsertCell({
  item,
  suggested,
  fresh,
  onPick,
}: {
  item: SlashItem;
  /** The Suggested copy of a kind that also has its own section's cell. */
  suggested?: boolean;
  /** Shows "New", as its "/" row does (`isNewItem`). */
  fresh?: boolean;
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
        <span className="st-insert-cell-label">
          {item.label}
          {HAS_NEW_BADGES && fresh ? (
            <span className="sr-only">, new</span>
          ) : null}
        </span>
        {item.reason ? (
          <span aria-hidden="true" className="st-insert-reason">
            {item.reason}
          </span>
        ) : null}
      </span>
      {HAS_NEW_BADGES && fresh ? (
        <span aria-hidden="true" data-slash-new="" className="st-insert-new">
          New
        </span>
      ) : null}
      {item.note && !item.reason ? (
        <span className="st-insert-note">{item.note}</span>
      ) : null}
      {opensStep(item) ? (
        <ChevronRightIcon
          aria-hidden="true"
          className="st-insert-chevron rtl:-scale-x-100"
        />
      ) : null}
    </ToolbarButton>
  );
}

/**
 * Cells in two columns of 44px, a group named by its heading `labelledBy`
 * (not a landmark region per section).
 */
function CellGroup({
  labelledBy,
  items,
  suggested,
  fresh,
  onPick,
}: {
  labelledBy: string;
  items: readonly SlashItem[];
  suggested?: boolean;
  fresh: ReadonlySet<string>;
  onPick: (item: SlashItem) => void;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="st-sheet-list">
      {items.map((item) => (
        <InsertCell
          key={item.key}
          item={item}
          suggested={suggested}
          fresh={fresh.has(item.key)}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

/** A titled section of cells. */
function CellSection({
  title,
  ...props
}: Omit<Parameters<typeof CellGroup>[0], "labelledBy"> & { title: ReactNode }) {
  const id = useId();
  return (
    <div className="st-sheet-section">
      <h3 id={id} className="st-sheet-heading">
        {title}
      </h3>
      <CellGroup labelledBy={id} {...props} />
    </div>
  );
}

export interface InsertSheetBodyProps {
  editor: Editor;
  step: InsertSheetStep | null;
  onStep: (step: InsertSheetStep | null) => void;
  /** Closes the sheet after a pick: focus goes back to the document. */
  onDone: () => void;
}

export function InsertSheetBody({
  editor,
  step,
  onStep,
  onDone,
}: InsertSheetBodyProps) {
  // Once per open (the body unmounts when the sheet closes), and again
  // after a refusal, so the refused cell shows its reason.
  const [{ groups, diagrams, fresh }, setModel] = useState(() =>
    buildModel(editor),
  );
  const [refused, setRefused] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const stepTitle = useId();

  // The first cell takes focus (Suggested's when present, spec §14) on
  // open, on Back and in the diagram step, whenever focus is not already
  // in the body: the cell that opened a step, or Back, has just unmounted.
  // The table and embed steps focus their own first control.
  useLayoutEffect(() => {
    const body = root.current;
    if (!body || (step && step !== "diagram")) return;
    if (body.contains(document.activeElement)) return;
    body.querySelector<HTMLElement>(".st-insert-cell")?.focus();
  }, [step]);

  const pick = useCallback(
    (item: SlashItem) => {
      const kind = STEP_OF[item.actionId];
      if (kind) return onStep(kind);
      if (item.key === DIAGRAM_CELL) return onStep("diagram");
      const action = editorActions.get(item.actionId);
      if (!action) return;
      // The page is inert while the sheet is open, so the action's own
      // focus stays put; the close hands focus back to the editor.
      if (runAction(editor, action, item.arg)) return onDone();
      // Cells are what could run when the sheet opened: the document
      // changed since (a collaborator's edit). The sheet stays, says why
      // on its own status line (the bar's pill is under it) and redraws.
      const enabled = availability(action, computeContext(editor));
      if (enabled === true) return onDone();
      setRefused(`${item.label}: ${enabled.reason}`);
      setModel(buildModel(editor));
    },
    [editor, onDone, onStep],
  );

  if (step) {
    return (
      <div ref={root} className="st-sheet-body" data-insert-step={step}>
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
          <h3 id={stepTitle} className="st-sheet-heading">
            {editorActions.get(STEP_ACTION[step])?.label}
          </h3>
        </div>
        {step === "diagram" ? (
          <CellGroup
            labelledBy={stepTitle}
            items={diagrams}
            fresh={fresh}
            onPick={pick}
          />
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
    <div ref={root} className="st-sheet-body">
      <p role="status" className="st-insert-refused">
        {refused}
      </p>
      {groups.map((group) => (
        <CellSection
          key={group.key}
          title={group.title}
          items={group.items}
          suggested={group.key === "suggested"}
          fresh={fresh}
          onPick={pick}
        />
      ))}
    </div>
  );
}
