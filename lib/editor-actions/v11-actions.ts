/**
 * PR E actions (spec §4.4, §5 M7/M11/M12/M14/M17b). Id prefixes:
 * palette. repeat. formats. template.
 *
 * Import rule (contract §4): never the registry index or the context
 * store, and never the RepeatFormatting extension module (it imports this
 * file for its key binding). Commands are reached through `editor.commands`.
 */
import type { Editor } from "@tiptap/core";

import {
  applyDisabledReason,
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
import { scanDocFormats } from "@/lib/doc-format-scan";
import {
  type AnyAction,
  type Ctx,
  defineAction,
  type Enabled,
} from "@/lib/editor-actions/types";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";
import {
  getMermaidTemplate,
  isMermaidTemplateId,
  lastMermaidTemplate,
  MERMAID_TEMPLATES,
  type MermaidTemplateId,
  rememberMermaidTemplate,
} from "@/lib/mermaid-templates";
import {
  FORMAT_REASONS,
  readSavedFormats,
  saveFormat,
} from "@/lib/saved-formats";

/** Arg prefix of an "In this doc" format: `doc:<bundleKey>`. */
export const DOC_FORMAT_PREFIX = "doc:";

const enabledFrom = (reason: string | null): Enabled =>
  reason === null ? true : { reason };

const isCodeOnly = (ctx: Ctx) =>
  applyDisabledReason(ctx.state, { bold: true }) === REPEAT_REASONS.code;

export const paletteOpenAction = defineAction({
  id: "palette.open",
  label: "All actions…",
  group: "view",
  contexts: "any",
  keywords: ["command", "palette", "search", "actions"],
  shortcut: "Alt-/",
  mutates: false,
  enabled: () => true,
  run: (editor) => emitUiIntent(editor, { type: "palette.open" }),
});

export const repeatApplyAction = defineAction({
  id: "repeat.apply",
  label: "Repeat formatting",
  group: "format",
  contexts: "any",
  keywords: ["format painter", "again", "f4", "paste formatting"],
  shortcut: "Mod-Alt-v",
  enabled: (ctx) =>
    enabledFrom(repeatDisabledReason(ctx.state, getRememberedBundle())),
  value: () => {
    const bundle = getRememberedBundle();
    return bundle ? bundleFace(bundle) : null;
  },
  run: (editor) => editor.commands.repeatFormatting(),
});

export const repeatCopyAction = defineAction({
  id: "repeat.copy",
  label: "Copy formatting",
  group: "format",
  contexts: "any",
  keywords: ["format painter", "pick up", "copy style"],
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
});

/** Whether the selection carries anything a saved format would keep. */
const hasSetFormatting = (ctx: Ctx): boolean =>
  ctx.memo(
    "formats.hasSet",
    () => !isEmptyBundle(setEntries(readBundleAt(ctx.state))),
  );

/** Arg: the format name. Saves the selection's set entries (M14). */
export const formatsSaveAction = defineAction<string>({
  id: "formats.save",
  label: "Save as format…",
  group: "format",
  contexts: "any",
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
    return saveFormat(name, bundle).ok;
  },
});

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

/** Arg: a saved format id, or `doc:<bundleKey>` for an "In this doc" one. */
export const formatsApplyAction = defineAction<string>({
  id: "formats.apply",
  label: "Apply format",
  group: "format",
  contexts: "any",
  keywords: ["your formats", "in this doc", "style", "preset"],
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
  options: (ctx) => [
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
});

const hasMermaid = (editor: Editor) => "insertMermaid" in editor.commands;

function canInsertMermaid(editor: Editor): boolean {
  return (
    hasMermaid(editor) &&
    editor.can().insertMermaid(MERMAID_TEMPLATES[0].source)
  );
}

/** Arg: a template id; defaults to the last one used (M17b). */
export const templateMermaidAction = defineAction<
  MermaidTemplateId | undefined
>({
  id: "template.mermaid",
  label: "Insert diagram",
  group: "insert",
  contexts: ["paragraph", "heading", "list", "table"],
  keywords: ["mermaid", "chart", "flowchart", "sequence", "mind map", "pie"],
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
});

export const v11Actions: readonly AnyAction[] = [
  paletteOpenAction,
  repeatApplyAction,
  repeatCopyAction,
  formatsSaveAction,
  formatsApplyAction,
  templateMermaidAction,
] as readonly AnyAction[];
