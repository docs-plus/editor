import type { MarkType, Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  type EditorState,
  NodeSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, type Step } from "@tiptap/pm/transform";

import {
  BOOLEAN_FIELDS,
  BUNDLE_FIELDS,
  type BundleField,
  FIELD_MARK,
  type FormatBundle,
  fieldOfMark,
  isEmptyBundle,
  TOKEN_ATTR,
  type TokenField,
  tokenOfMark,
} from "./bundle";

/**
 * Transaction meta set by Repeat / apply, valued with the bundle applied:
 * never recorded as a new bundle; it becomes the session's bundle.
 */
export const REPEAT_META = "repeatFormatting";

/** Disabled reasons (full sentences, contract §4). */
export const REPEAT_REASONS = {
  noBundle: "Format some text first, or use Copy formatting.",
  noText: "Select text to repeat formatting.",
  code: "Code has no formatting.",
  heading: "Headings scale automatically.",
} as const;

const isTokenField = (field: BundleField): field is TokenField =>
  !(BOOLEAN_FIELDS as readonly string[]).includes(field);

const isMarkStep = (step: Step): boolean =>
  step instanceof AddMarkStep || step instanceof RemoveMarkStep;

/**
 * The bundle a transaction's local mark steps express: `AddMarkStep` sets
 * the field, `RemoveMarkStep` clears it, later steps win, other marks are
 * ignored. Empty unless every step is a mark step. Cheap: no step, no
 * work (runs on every keystroke).
 */
export function bundlePatchFromSteps(tr: Transaction): FormatBundle {
  const patch: Record<string, boolean | string | null> = {};
  // Mark-only transactions only (contract §6, exception 3): a heading
  // change or block conversion that also strips marks never clobbers the
  // bundle.
  if (!tr.steps.every(isMarkStep)) return patch as FormatBundle;
  for (const step of tr.steps) {
    const added = step instanceof AddMarkStep;
    const { mark } = step as AddMarkStep | RemoveMarkStep;
    const field = fieldOfMark(mark.type.name);
    if (!field) continue;
    if (!isTokenField(field)) patch[field] = added;
    else if (!added) patch[field] = null;
    else {
      const token = tokenOfMark(field, mark);
      if (token) patch[field] = token;
    }
  }
  return patch as FormatBundle;
}

function isCodeBlock(node: ProseMirrorNode): boolean {
  return Boolean(node.type.spec.code);
}

/**
 * Runs `fn` over each textblock slice of the selection's ranges; `fn`
 * returning true stops the walk.
 */
function forEachTextblockSlice(
  state: { doc: ProseMirrorNode; selection: EditorState["selection"] },
  fn: (block: ProseMirrorNode, from: number, to: number) => unknown,
): void {
  let stop = false;
  for (const range of state.selection.ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (stop) return false;
      if (!node.isTextblock) return true;
      const start = Math.max(from, pos + 1);
      const end = Math.min(to, pos + node.nodeSize - 1);
      if (end > start && fn(node, start, end) === true) stop = true;
      return false;
    });
    if (stop) return;
  }
}

/**
 * Sets (never toggles) every field of `bundle` across the selection's
 * ranges (CellSelection safe) in `tr`. Fields whose mark type the schema
 * lacks are skipped. Code takes no marks (the schema refuses them), and
 * `fontSize` is only touched outside headings and the title.
 */
export function applyBundle(
  tr: Transaction,
  bundle: FormatBundle,
): Transaction {
  const { schema } = tr.doc.type;
  for (const field of BUNDLE_FIELDS) {
    const value = bundle[field];
    if (value === undefined) continue;
    const type: MarkType | undefined = schema.marks[FIELD_MARK[field]];
    if (!type) continue;
    const mark =
      value === true
        ? type.create()
        : typeof value === "string" && isTokenField(field)
          ? type.create({ [TOKEN_ATTR[field]]: value })
          : null;
    forEachTextblockSlice(tr, (block, from, to) => {
      if (isCodeBlock(block)) return;
      if (field === "fontSize" && block.type.name === "heading") return;
      if (mark) tr.addMark(from, to, mark);
      else tr.removeMark(from, to, type);
    });
  }
  return tr;
}

/**
 * Whether every selected character is code (code blocks, inline code).
 * Stops at the first formattable character: the usual answer, so a long
 * selection of prose costs one text node, not a whole-selection walk.
 */
export function onlyCode(state: EditorState): boolean {
  let sawText = false;
  let sawFormattable = false;
  const inlineCode = state.schema.marks.inlineCode;
  forEachTextblockSlice(state, (block, from, to) => {
    if (isCodeBlock(block)) {
      sawText = true;
      return false;
    }
    state.doc.nodesBetween(from, to, (node) => {
      if (sawFormattable) return false;
      if (!node.isText) return true;
      sawText = true;
      if (!inlineCode?.isInSet(node.marks)) sawFormattable = true;
      return false;
    });
    return sawFormattable;
  });
  return sawText && !sawFormattable;
}

function allHeadings(state: EditorState): boolean {
  let all = true;
  forEachTextblockSlice(state, (block) => {
    if (block.type.name !== "heading") all = false;
  });
  return all;
}

/** Why Repeat (or applying a bundle) cannot run here, or null. */
export function repeatDisabledReason(
  state: EditorState,
  bundle: FormatBundle | null,
  codeOnly?: () => boolean,
): string | null {
  if (!bundle || isEmptyBundle(bundle)) return REPEAT_REASONS.noBundle;
  return applyDisabledReason(state, bundle, codeOnly);
}

/**
 * Like `repeatDisabledReason`, for a bundle known to exist. `codeOnly`
 * lets a caller share one `onlyCode` walk per snapshot (`ctx.memo`).
 */
export function applyDisabledReason(
  state: EditorState,
  bundle: FormatBundle,
  codeOnly: () => boolean = () => onlyCode(state),
): string | null {
  const { selection } = state;
  if (selection.empty || selection instanceof NodeSelection) {
    return REPEAT_REASONS.noText;
  }
  if (codeOnly()) return REPEAT_REASONS.code;
  const fields = BUNDLE_FIELDS.filter((field) => bundle[field] !== undefined);
  if (fields.length === 1 && fields[0] === "fontSize" && allHeadings(state)) {
    return REPEAT_REASONS.heading;
  }
  return null;
}
