/**
 * PR E's action bodies, commands and bundle recorder: the lazy half of
 * `v11-actions.ts` (contract §10, editor-chunk budget A11). Loaded by the
 * `RepeatFormatting` extension as soon as an editor is created. Only
 * `loadV11Engine()` imports this module, so its code lives in exactly one
 * chunk: E's surfaces (palette, Repeat split button, phone cells) reach it
 * through `getV11Engine()` / `loadV11Engine()` and show
 * `ENGINE_LOADING_REASON` until it lands (`v11-engine-ready.ts`).
 * Evaluating this module installs it and makes the registry's E actions
 * live.
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
  REPEAT_META,
  REPEAT_REASONS,
  repeatDisabledReason,
} from "@/extensions/repeat-formatting/apply-bundle";
import {
  bundleFace,
  bundleFromKey,
  bundleKey,
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
import { scanDocFormats } from "@/lib/doc-format-scan";
import type { ActionOption, Ctx, Enabled } from "@/lib/editor-actions/types";
import {
  DOC_FORMAT_PREFIX,
  installV11Engine,
  type RepeatSession,
  type V11Engine,
} from "@/lib/editor-actions/v11-actions";
import {
  getMermaidTemplate,
  isMermaidTemplateId,
  lastMermaidTemplate,
  MERMAID_TEMPLATES,
  rememberMermaidTemplate,
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

const isCodeOnly = (ctx: Ctx) =>
  applyDisabledReason(ctx.state, { bold: true }) === REPEAT_REASONS.code;

/** Whether the selection carries anything a saved format would keep. */
const hasSetFormatting = (ctx: Ctx): boolean =>
  ctx.memo(
    "formats.hasSet",
    () => !isEmptyBundle(setEntries(readBundleAt(ctx.state))),
  );

function docBundles(ctx: Ctx): readonly FormatBundle[] {
  return ctx.docMemo("formats.docScan", () => scanDocFormats(ctx.state.doc))
    .bundles;
}

function resolveFormat(id: unknown): FormatBundle | null {
  if (typeof id !== "string") return null;
  if (id.startsWith(DOC_FORMAT_PREFIX)) {
    const bundle = bundleFromKey(id.slice(DOC_FORMAT_PREFIX.length));
    return bundle ? setEntries(bundle) : null;
  }
  return readSavedFormats().find((format) => format.id === id)?.bundle ?? null;
}

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
  applyBundle(tr, bundle).setMeta(REPEAT_META, true);
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
  if (tr.getMeta(REPEAT_META)) {
    undoManagerOf(state)?.stopCapturing();
    session.range = toSessionRange(state, tr.selection);
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
  if (session.range) session.range = mapSessionRange(session.range, tr);
  if (!tr.docChanged && !tr.selectionSet) return;
  const { selection } = state;
  const patch = tr.docChanged ? bundlePatchFromSteps(tr) : {};
  if (!isEmptyBundle(patch) && !selection.empty) {
    const same =
      session.range !== null &&
      sameRange(fromSessionRange(state, session.range), selection);
    const base = same ? getRememberedBundle() : null;
    rememberBundle(base ? { ...base, ...patch } : patch);
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

export const v11Engine: V11Engine = {
  record,
  formatSaveReason,
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
      enabled: (ctx) =>
        enabledFrom(repeatDisabledReason(ctx.state, getRememberedBundle())),
      value: () => {
        const bundle = getRememberedBundle();
        return bundle ? bundleFace(bundle) : null;
      },
      run: (editor) => editor.commands.repeatFormatting(),
    },
    "repeat.copy": {
      enabled: (ctx) =>
        ctx.nodeSelectionType !== null
          ? { reason: "Select text to copy its formatting." }
          : isCodeOnly(ctx)
            ? { reason: REPEAT_REASONS.code }
            : true,
      run: (editor) => {
        if (!editor.commands.copyFormatting()) return false;
        rememberBundle(readBundleAt(editor.state));
        return true;
      },
    },
    "formats.save": {
      enabled: (ctx) =>
        isCodeOnly(ctx)
          ? { reason: REPEAT_REASONS.code }
          : hasSetFormatting(ctx)
            ? true
            : { reason: FORMAT_REASONS.empty },
      run: (editor, name) => {
        const bundle = setEntries(readBundleAt(editor.state));
        if (isEmptyBundle(bundle)) return false;
        return saveFormat(name, bundle).ok;
      },
    },
    "formats.apply": {
      enabled: (ctx) => {
        if (readSavedFormats().length === 0 && docBundles(ctx).length === 0) {
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
      options: (ctx): readonly ActionOption<unknown>[] => [
        ...readSavedFormats().map((format) => ({
          value: format.id,
          label: format.name,
          keywords: [bundleFace(format.bundle)],
        })),
        ...docBundles(ctx).map((bundle) => ({
          value: `${DOC_FORMAT_PREFIX}${bundleKey(bundle)}`,
          label: `${bundleFace(bundle)} (in this doc)`,
          keywords: ["in this doc"],
        })),
      ],
      run: (editor, id) => {
        const bundle = resolveFormat(id);
        if (!bundle || isEmptyBundle(bundle)) return false;
        if (!editor.commands.applyFormatBundle(bundle)) return false;
        rememberBundle(bundle);
        return true;
      },
    },
    "template.mermaid": {
      enabled: (ctx) =>
        ctx.can("insertMermaid", canInsertMermaid)
          ? true
          : { reason: "Diagrams cannot go here." },
      options: () =>
        MERMAID_TEMPLATES.map((template) => ({
          value: template.id,
          label: template.label,
          keywords: [template.id],
        })),
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
