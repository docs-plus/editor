/**
 * PR E actions (spec §4.4, §5 M7/M11/M12/M14/M17b). Id prefixes:
 * palette. repeat. formats. template.
 *
 * Only the definitions are eager. Their bodies, the Repeat commands and
 * the bundle recorder live in `v11-engine.ts`, a lazy chunk the
 * `RepeatFormatting` extension starts loading when an editor is created
 * (editor-chunk budget, contract A11 and E's A8). Until it lands, the E
 * actions are unavailable with `ENGINE_LOADING_REASON` and run nothing.
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
import {
  type Action,
  type ActionOption,
  type AnyAction,
  type Ctx,
  defineAction,
  type Enabled,
} from "@/lib/editor-actions/types";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";

/** Arg prefix of an "In this doc" format: `doc:<bundleKey>`. */
export const DOC_FORMAT_PREFIX = "doc:";

/** Reason of every E action while its chunk is still loading. */
export const ENGINE_LOADING_REASON = "Formatting tools are still loading.";

/** The Repeat "extend" session of one editor (memory only). */
export interface RepeatSession {
  range: SessionRange | null;
  /**
   * What this session has built so far. Extending merges into it, never
   * into the shared remembered bundle, which another tab may have
   * replaced in the meantime.
   */
  bundle: FormatBundle | null;
}

type CommandProps = {
  state: EditorState;
  tr: Transaction;
  dispatch?: (tr: Transaction) => void;
  editor: { isEditable: boolean };
};

interface EngineAction {
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
   * The Repeat key in an editable editor: repeats, or announces why it
   * cannot. Always handles the key.
   */
  repeatKey(editor: Editor): true;
}

let engine: V11Engine | null = null;
let loading: Promise<V11Engine> | null = null;
const installed = new Set<() => void>();

/** The loaded engine, or null while its chunk is on its way. */
export const getV11Engine = (): V11Engine | null => engine;

/** Calls `listener` when the engine installs (`useSyncExternalStore` shape). */
export function subscribeV11Engine(listener: () => void): () => void {
  installed.add(listener);
  return () => {
    installed.delete(listener);
  };
}

/**
 * Called by `v11-engine.ts` when it is evaluated, and by the load (a
 * no-op then, except after a test reset). Tells subscribers once.
 */
export function installV11Engine(loaded: V11Engine): void {
  if (engine) return;
  engine = loaded;
  for (const listener of [...installed]) listener();
}

/**
 * Fetches the engine chunk once. A failed fetch (offline, or a deploy
 * replaced the chunk) clears the promise, so the next editor retries.
 */
export function loadV11Engine(): Promise<V11Engine> {
  loading ??= import("./v11-engine").then(
    (module) => {
      installV11Engine(module.v11Engine);
      return module.v11Engine;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Test hook: back to before the chunk landed (listeners are kept). */
export function resetV11EngineForTests(): void {
  engine = null;
  loading = null;
}

const LOADING: Enabled = { reason: ENGINE_LOADING_REASON };

/** An E action whose behaviour comes from the engine once it is loaded. */
function engineAction<Arg>(
  meta: Omit<Action<Arg>, "enabled" | "value" | "options" | "run">,
  extras: { value?: true; options?: true } = {},
): Action<Arg> {
  const id = meta.id as EngineActionId;
  const body = () => engine?.actions[id];
  return defineAction<Arg>({
    ...meta,
    enabled: (ctx) => body()?.enabled(ctx) ?? LOADING,
    value: extras.value ? (ctx) => body()?.value?.(ctx) ?? null : undefined,
    options: extras.options
      ? (ctx) => (body()?.options?.(ctx) ?? []) as readonly ActionOption<Arg>[]
      : undefined,
    run: (editor, arg) => body()?.run(editor, arg) ?? false,
  });
}

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

export const repeatApplyAction = engineAction(
  {
    id: "repeat.apply",
    label: "Repeat formatting",
    group: "format",
    contexts: "any",
    keywords: ["format painter", "again", "f4", "paste formatting"],
    shortcut: "Mod-Alt-v",
  },
  { value: true },
);

export const repeatCopyAction = engineAction({
  id: "repeat.copy",
  label: "Copy formatting",
  group: "format",
  contexts: "any",
  keywords: ["format painter", "pick up", "copy style"],
});

/** Arg: the format name. Saves the selection's set entries (M14). */
export const formatsSaveAction = engineAction<string>({
  id: "formats.save",
  label: "Save as format…",
  group: "format",
  contexts: "any",
  keywords: ["style", "preset", "your formats"],
});

/** Arg: a saved format id, or `doc:<bundleKey>` for an "In this doc" one. */
export const formatsApplyAction = engineAction<string>(
  {
    id: "formats.apply",
    label: "Apply format",
    group: "format",
    contexts: "any",
    keywords: ["your formats", "in this doc", "style", "preset"],
  },
  { options: true },
);

/** Arg: a template id; defaults to the last one used (M17b). */
export const templateMermaidAction = engineAction<string | undefined>(
  {
    id: "template.mermaid",
    label: "Insert diagram",
    group: "insert",
    contexts: ["paragraph", "heading", "list", "table"],
    keywords: ["mermaid", "chart", "flowchart", "sequence", "mind map", "pie"],
  },
  { options: true },
);

export const v11Actions: readonly AnyAction[] = [
  paletteOpenAction,
  repeatApplyAction,
  repeatCopyAction,
  formatsSaveAction,
  formatsApplyAction,
  templateMermaidAction,
] as readonly AnyAction[];
