/**
 * PR E actions (spec §4.4, §5 M7/M11/M12/M14/M17b). Id prefixes:
 * palette. repeat. formats. template.
 *
 * Only the definitions are eager. Their bodies, the Repeat commands and
 * the bundle recorder live in `v11-engine.ts`, a lazy chunk the
 * `RepeatFormatting` extension starts loading when an editor is created
 * (editor-chunk budget, contract A11 and E's A8). Until it lands, the E
 * actions are available and queue their runs, which go through
 * `runAction` once it lands if the selection has not moved (design pass:
 * loading is not a state the user sees).
 * `loadV11Engine()` is the engine's only importer: a static import from a
 * surface would put a second copy of it in that surface's chunk.
 *
 * Import rule (contract §4): never the registry index or the context
 * store, and never the RepeatFormatting extension module (it imports this
 * file for its key binding). Commands are reached through `editor.commands`.
 */
import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import type { FormatBundle } from "@/extensions/repeat-formatting/bundle";
import type { SessionRange } from "@/extensions/repeat-formatting/relative-range";
import { announceLater } from "@/lib/announce-later";
import { runAction } from "@/lib/editor-actions/registry";
import {
  type Action,
  type ActionOption,
  type AnyAction,
  type Ctx,
  defineAction,
  type Enabled,
} from "@/lib/editor-actions/types";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";

/**
 * Kept for the palette's save view, which loads after the engine; no E
 * action shows it any more (design pass §6, principle 4).
 */
export const ENGINE_LOADING_REASON = "Formatting tools are still loading.";

/** The Repeat "extend" session of one editor (memory only). */
export interface RepeatSession {
  range: SessionRange | null;
  /**
   * What this session has built so far. Extending merges into it, never
   * into the shared remembered bundle, which another tab may have
   * replaced in the meantime.
   */
  bundle?: FormatBundle;
}

type CommandProps = {
  state: EditorState;
  tr: Transaction;
  dispatch?: (tr: Transaction) => void;
  editor: { isEditable: boolean };
};

interface EngineAction {
  /** Search keywords: palette-only, so they ride with the engine. */
  keywords: readonly string[];
  enabled(ctx: Ctx): Enabled;
  value?(ctx: Ctx): string | null;
  options?(ctx: Ctx): readonly ActionOption<unknown>[];
  run(editor: Editor, arg: unknown): boolean;
}

type EngineActionId =
  | "repeat.apply"
  | "repeat.copy"
  | "formats.save"
  | "formats.apply"
  | "template.mermaid";

/** What `v11-engine.ts` provides once loaded. */
export interface V11Engine {
  actions: Readonly<Record<EngineActionId, EngineAction>>;
  commands: {
    repeatFormatting(props: CommandProps): boolean;
    applyFormatBundle(
      bundle: Parameters<Editor["commands"]["applyFormatBundle"]>[0],
      props: CommandProps,
    ): boolean;
  };
  record(session: RepeatSession, tr: Transaction, state: EditorState): void;
  /** Why the selection cannot be saved under `name` now, or null. */
  formatSaveReason(editor: Editor, name: string): string | null;
  /**
   * The Repeat key in an editable editor: repeats (or paints, while Paint
   * format is armed), or announces why it cannot. Always handles the key.
   */
  repeatKey(editor: Editor): true;
  /** Paint format (design pass §2), for the brushes. */
  paint: {
    isPainting(editor: Editor): boolean;
    subscribe(listener: () => void): () => void;
    /** Arms; armed, applies to a new selection or cancels. */
    toggle(editor: Editor, touch?: boolean): boolean;
  };
}

let engine: V11Engine | null = null;
let loading: Promise<V11Engine> | null = null;

/** The loaded engine, or null while its chunk is on its way. */
export const getV11Engine = (): V11Engine | null => engine;

/**
 * Called once by `v11-engine.ts` when it is evaluated. Only
 * `loadV11Engine()` imports that module, so its promise is the landing
 * notice: the editors' buffers, `useV11EngineReady()` and the palette all
 * wait on it (no listener set here: the eager chunk has no room).
 */
export function installV11Engine(loaded: V11Engine): void {
  engine = loaded;
}

/**
 * Fetches the engine chunk once. A failed fetch (offline, or a deploy
 * replaced the chunk) clears the promise, so the next editor retries.
 */
export function loadV11Engine(): Promise<V11Engine> {
  loading ??= import("./v11-engine").then(
    (module) => module.v11Engine,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/**
 * Runs `run` now when the engine is in; otherwise once it lands, if the
 * selection has not moved. Loading itself is never shown (design pass,
 * principle 4); a failed load (offline, a replaced chunk) says so on the
 * pill with Retry, which tries again (§5).
 */
export function runWithEngine(editor: Editor, run: () => void): void {
  if (engine) {
    run();
    return;
  }
  const { selection } = editor.state;
  loadV11Engine().then(
    () => {
      if (!editor.isDestroyed && editor.state.selection.eq(selection)) run();
    },
    () =>
      announceLater("Couldn’t load formatting tools.", {
        action: { label: "Retry", run: () => runWithEngine(editor, run) },
      }),
  );
}

/** Test hook: back to before the chunk landed. */
export function resetV11EngineForTests(): void {
  engine = null;
  loading = null;
}

/**
 * An E action whose behaviour comes from the engine once it is loaded.
 * `value` and `options` always exist (null and [] without a body): the
 * same to every reader as leaving them out, and smaller. Its keywords are
 * the engine's too: only the palette searches them, and it loads after
 * the engine (editor-chunk budget). Before the engine lands it is
 * available, and a run waits for it (`runWithEngine`), then runs through
 * `runAction` (which rechecks), as the Repeat key does.
 */
function engineAction<Arg>(
  meta: Omit<Action<Arg>, "enabled" | "value" | "options" | "run" | "keywords">,
): Action<Arg> {
  const id = meta.id as EngineActionId;
  const body = () => engine?.actions[id];
  const action: Action<Arg> = defineAction<Arg>({
    ...meta,
    get keywords() {
      return body()?.keywords;
    },
    enabled: (ctx) => body()?.enabled(ctx) ?? true,
    value: (ctx) => body()?.value?.(ctx) ?? null,
    options: (ctx) =>
      (body()?.options?.(ctx) ?? []) as readonly ActionOption<Arg>[],
    run(editor, arg) {
      const loaded = body();
      if (loaded) return loaded.run(editor, arg);
      runWithEngine(editor, () => runAction(editor, action as AnyAction, arg));
      return true;
    },
  });
  return action;
}

/** No keywords: the palette never lists itself (editor-chunk budget). */
export const paletteOpenAction = defineAction({
  id: "palette.open",
  label: "All actions…",
  group: "view",
  contexts: "any",
  shortcut: "Alt-/",
  mutates: false,
  enabled: () => true,
  run: (editor) => emitUiIntent(editor, { type: "palette.open" }),
});

export const repeatApplyAction = engineAction({
  id: "repeat.apply",
  label: "Repeat formatting",
  group: "format",
  contexts: "any",
  shortcut: "Mod-Alt-v",
});

/** Paint format (design pass §2); arg "touch" from a tapped brush. */
export const repeatCopyAction = engineAction<string | undefined>({
  id: "repeat.copy",
  label: "Paint format",
  group: "format",
  contexts: "any",
});

/** Arg: the format name. Saves the selection's set entries (M14). */
export const formatsSaveAction = engineAction<string>({
  id: "formats.save",
  label: "Save as format…",
  group: "format",
  contexts: "any",
});

/** Arg: a saved format id. */
export const formatsApplyAction = engineAction<string>({
  id: "formats.apply",
  label: "Apply format",
  group: "format",
  contexts: "any",
});

/** Arg: a template id; defaults to the last one used (M17b). */
export const templateMermaidAction = engineAction<string | undefined>({
  id: "template.mermaid",
  label: "Insert diagram",
  group: "insert",
  contexts: ["paragraph", "heading", "list", "table"],
});

export const v11Actions: readonly AnyAction[] = [
  paletteOpenAction,
  repeatApplyAction,
  repeatCopyAction,
  formatsSaveAction,
  formatsApplyAction,
  templateMermaidAction,
] as readonly AnyAction[];
