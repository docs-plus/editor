/**
 * PR E's action bodies, commands and bundle recorder: the lazy half of
 * `v11-actions.ts` (contract §10, editor-chunk budget A11). Loaded by the
 * `RepeatFormatting` extension as soon as an editor is created. Only
 * `loadV11Engine()` imports this module, so its code lives in exactly one
 * chunk: E's surfaces (palette, Paint format brushes, style dropdown,
 * phone cells) reach it through `getV11Engine()` / `loadV11Engine()`;
 * until it lands the E actions queue their runs (design pass,
 * "loading is not a state the user sees"). Evaluating this module
 * installs it and makes the registry's E actions live. Paint format's
 * state lives in `paint-format.ts`, imported only from here.
 *
 * Import rule (contract §4): never the registry index or the context store.
 */
import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey, yUndoPluginKey } from "@tiptap/y-tiptap";

import {
  applyBundle,
  applyDisabledReason,
  bundlePatchFromSteps,
  onlyCode,
  REPEAT_META,
  REPEAT_REASONS,
  repeatDisabledReason,
} from "@/extensions/repeat-formatting/apply-bundle";
import {
  bundleLabel,
  bundleSetLabel,
  type FormatBundle,
  isEmptyBundle,
  readBundleAt,
  setEntries,
} from "@/extensions/repeat-formatting/bundle";
import {
  getRememberedBundle,
  rememberBundle,
} from "@/extensions/repeat-formatting/bundle-memory";
import {
  fromSessionRange,
  mapSessionRange,
  sameRange,
  toSessionRange,
} from "@/extensions/repeat-formatting/relative-range";
import { announce } from "@/lib/announce";
import {
  applyPaint,
  cancelPaint,
  isPainting,
  subscribePaint,
  togglePaint,
} from "@/lib/editor-actions/paint-format";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { ActionOption, Ctx, Enabled } from "@/lib/editor-actions/types";
import {
  installV11Engine,
  type RepeatSession,
  repeatApplyAction,
  type V11Engine,
} from "@/lib/editor-actions/v11-actions";
import { computeContext } from "@/lib/editor-context/snapshot";
import {
  getMermaidTemplate,
  isMermaidTemplateId,
  lastMermaidTemplate,
  MERMAID_TEMPLATES,
  rememberMermaidTemplate,
  usedMermaidTemplate,
} from "@/lib/mermaid-templates";
import {
  FORMAT_REASONS,
  MAX_SAVED_FORMATS,
  readSavedFormats,
  sanitizeFormatName,
  saveFormat,
} from "@/lib/saved-formats";

const enabledFrom = (reason: string | null): Enabled =>
  reason === null ? true : { reason };

/** The selection-wide code walk, once per snapshot for every E action. */
const codeOnlyOf = (ctx: Ctx) => () =>
  ctx.memo("repeat.onlyCode", () => onlyCode(ctx.state));

const isCodeOnly = (ctx: Ctx) =>
  applyDisabledReason(ctx.state, { bold: true }, codeOnlyOf(ctx)) ===
  REPEAT_REASONS.code;

/** Whether the selection carries anything a saved format would keep. */
const hasSetFormatting = (ctx: Ctx): boolean =>
  ctx.memo(
    "formats.hasSet",
    () => !isEmptyBundle(setEntries(readBundleAt(ctx.state))),
  );

const savedFormat = (id: unknown) =>
  readSavedFormats().find((format) => format.id === id);

const hasMermaid = (editor: Editor) => "insertMermaid" in editor.commands;

function canInsertMermaid(editor: Editor): boolean {
  return (
    hasMermaid(editor) &&
    editor.can().insertMermaid(MERMAID_TEMPLATES[0].source)
  );
}

interface UndoManagerLike {
  stopCapturing(): void;
}

function undoManagerOf(state: EditorState): UndoManagerLike | null {
  return (
    (yUndoPluginKey.getState(state)?.undoManager as
      | UndoManagerLike
      | undefined) ?? null
  );
}

interface CommandProps {
  state: EditorState;
  tr: Transaction;
  dispatch?: (tr: Transaction) => void;
  editor: { isEditable: boolean };
}

/**
 * Sets (never toggles) `bundle`'s marks as one transaction wrapped in
 * `stopCapturing()`, so it is exactly one undo step. The recorder stops
 * capturing again once the Yjs write is done, so typing that follows is
 * its own undo step.
 */
function applyCommand(
  bundle: FormatBundle,
  { state, tr, dispatch, editor }: CommandProps,
): boolean {
  if (!editor.isEditable) return false;
  if (applyDisabledReason(state, bundle) !== null) return false;
  if (!dispatch) return true;
  undoManagerOf(state)?.stopCapturing();
  applyBundle(tr, bundle).setMeta(REPEAT_META, bundle);
  return true;
}

/**
 * Records a bundle from local mark-only transactions (contract §6,
 * exception 3) and keeps the "extend" session as Yjs relative positions.
 * `state` is the editor state right after `tr`.
 */
function record(
  session: RepeatSession,
  tr: Transaction,
  state: EditorState,
): void {
  const applied = tr.getMeta(REPEAT_META) as FormatBundle | undefined;
  if (applied) {
    undoManagerOf(state)?.stopCapturing();
    session.range = toSessionRange(state, tr.selection);
    session.bundle = applied;
    return;
  }
  const sync = tr.getMeta(ySyncPluginKey) as
    | { isUndoRedoOperation?: boolean }
    | undefined;
  if (sync) {
    // Remote edits never record or close; undo and redo close.
    if (sync.isUndoRedoOperation) session.range = null;
    return;
  }
  if (session.range) {
    // "Forget my choices" (here or in another tab) ends the session: what
    // it built must not come back with the next format.
    session.range =
      getRememberedBundle() === null
        ? null
        : mapSessionRange(session.range, tr);
  }
  if (!tr.docChanged && !tr.selectionSet) return;
  const { selection } = state;
  const patch = tr.docChanged ? bundlePatchFromSteps(tr) : {};
  if (!isEmptyBundle(patch) && !selection.empty) {
    const same =
      session.range !== null &&
      sameRange(fromSessionRange(state, session.range), selection);
    // The session's own bundle, never the shared memory: another tab may
    // have written its own bundle there since.
    const bundle = same ? { ...session.bundle, ...patch } : patch;
    session.bundle = bundle;
    rememberBundle(bundle);
    session.range = toSessionRange(state, selection);
  } else if (
    tr.selectionSet &&
    session.range &&
    !sameRange(fromSessionRange(state, session.range), selection)
  ) {
    session.range = null;
  }
}

function formatSaveReason(editor: Editor, name: string): string | null {
  const cleanName = sanitizeFormatName(name);
  if (!cleanName) return FORMAT_REASONS.name;
  if (isEmptyBundle(setEntries(readBundleAt(editor.state)))) {
    return FORMAT_REASONS.empty;
  }
  const formats = readSavedFormats();
  const exists = formats.some(
    (format) => format.name.toLowerCase() === cleanName.toLowerCase(),
  );
  if (!exists && formats.length >= MAX_SAVED_FORMATS) return FORMAT_REASONS.cap;
  return null;
}

/**
 * Repeats with the key, or says why not; the key is always handled. While
 * Paint format is armed the key paints instead (design pass §2).
 */
function repeatKey(editor: Editor): true {
  if (isPainting(editor)) applyPaint(editor);
  else if (!runAction(editor, repeatApplyAction)) {
    const enabled = availability(repeatApplyAction, computeContext(editor));
    if (enabled !== true) announce(enabled.reason);
  }
  return true;
}

export const v11Engine: V11Engine = {
  record,
  formatSaveReason,
  repeatKey,
  paint: { isPainting, subscribe: subscribePaint, toggle: togglePaint },
  commands: {
    repeatFormatting: (props) => {
      const bundle = getRememberedBundle();
      if (!bundle || repeatDisabledReason(props.state, bundle) !== null) {
        return false;
      }
      return applyCommand(bundle, props);
    },
    applyFormatBundle: (bundle, props) =>
      !isEmptyBundle(bundle) && applyCommand(bundle, props),
  },
  actions: {
    "repeat.apply": {
      // "format painter" is Paint format's (design pass §8).
      keywords: ["again", "f4", "paste formatting"],
      enabled: (ctx) =>
        enabledFrom(
          repeatDisabledReason(
            ctx.state,
            getRememberedBundle(),
            codeOnlyOf(ctx),
          ),
        ),
      // The long label from set fields only: "Bold, Yellow highlight".
      value: () => {
        const bundle = getRememberedBundle();
        return bundle ? bundleSetLabel(bundle) : null;
      },
      run: (editor) => {
        const bundle = getRememberedBundle();
        if (!bundle || !editor.commands.repeatFormatting()) return false;
        cancelPaint(editor);
        announce(`Repeated ${bundleSetLabel(bundle)}`, { done: true });
        return true;
      },
    },
    "repeat.copy": {
      keywords: [
        "copy formatting",
        "format painter",
        "brush",
        "pick up",
        "copy style",
      ],
      enabled: (ctx) =>
        ctx.nodeSelectionType !== null
          ? { reason: "Select text to pick up its formatting." }
          : isCodeOnly(ctx)
            ? { reason: REPEAT_REASONS.code }
            : true,
      // Arg "touch": the brush was tapped (its pill says tap it again).
      run: (editor, arg) => togglePaint(editor, arg === "touch"),
    },
    "formats.save": {
      keywords: ["style", "preset", "your formats"],
      enabled: (ctx) =>
        isCodeOnly(ctx)
          ? { reason: REPEAT_REASONS.code }
          : hasSetFormatting(ctx)
            ? true
            : { reason: FORMAT_REASONS.empty },
      run: (editor, name) => {
        const bundle = setEntries(readBundleAt(editor.state));
        if (isEmptyBundle(bundle)) return false;
        const result = saveFormat(name, bundle);
        if (!result.ok) return false;
        announce(
          result.replaced === undefined
            ? `Saved format ‘${result.format.name}’`
            : `Replaced format ‘${result.replaced}’`,
          { done: true },
        );
        return true;
      },
    },
    "formats.apply": {
      keywords: ["your formats", "style", "preset"],
      enabled: (ctx) => {
        if (readSavedFormats().length === 0) {
          return { reason: "Save a format first." };
        }
        return enabledFrom(
          ctx.empty || ctx.nodeSelectionType !== null
            ? "Select text to apply a format."
            : isCodeOnly(ctx)
              ? REPEAT_REASONS.code
              : null,
        );
      },
      options: (): readonly ActionOption<unknown>[] =>
        readSavedFormats().map((format) => ({
          value: format.id,
          label: format.name,
          keywords: [bundleLabel(format.bundle)],
          bundle: format.bundle,
        })),
      run: (editor, id) => {
        const format = savedFormat(id);
        if (!format || isEmptyBundle(format.bundle)) return false;
        if (!editor.commands.applyFormatBundle(format.bundle)) return false;
        rememberBundle(format.bundle);
        announce(`Applied ‘${format.name}’`, { done: true });
        return true;
      },
    },
    "template.mermaid": {
      keywords: [
        "mermaid",
        "chart",
        "flowchart",
        "sequence",
        "mind map",
        "pie",
      ],
      enabled: (ctx) =>
        ctx.can("insertMermaid", canInsertMermaid)
          ? true
          : { reason: "Diagrams cannot go here." },
      options: () => {
        const last = usedMermaidTemplate();
        return MERMAID_TEMPLATES.map((template) => ({
          value: template.id,
          label: template.label,
          keywords: [template.id],
          note: template.id === last ? "Last used" : undefined,
        }));
      },
      run: (editor, arg) => {
        if (!hasMermaid(editor)) return false;
        const id = isMermaidTemplateId(arg) ? arg : lastMermaidTemplate();
        const { source } = getMermaidTemplate(id);
        const inserted = editor.chain().focus().insertMermaid(source).run();
        if (inserted) rememberMermaidTemplate(id);
        return inserted;
      },
    },
  },
};

installV11Engine(v11Engine);
